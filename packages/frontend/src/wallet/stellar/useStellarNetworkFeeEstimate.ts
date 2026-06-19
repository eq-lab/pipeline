/**
 * Stellar/Soroban network-fee estimate hook for the deposit/withdraw/stake/unstake pages.
 *
 * Returns the simulated Soroban resource fee (in XLM) for a representative
 * `request_deposit`, `request_withdrawal`, vault `deposit` (stake), or vault
 * `redeem` (unstake) call. No USD conversion — format is `~0.00xx XLM` per
 * the OQ2 resolution.
 *
 * Implementation notes
 * --------------------
 * The fee is extracted from the assembled transaction returned by the relevant
 * client builder. The Soroban RPC assembles the tx with the full resource fee
 * embedded; parsing that fee (in stroops) gives an accurate estimate.
 *
 * When disconnected, unconfigured, or when the simulation fails, the hook
 * returns `{ feeXlm: undefined }` (callers render "—").
 *
 * Mock-key support (localStorage — dev only):
 *   `pipeline.mock.wallet.stellar.networkFeeEstimate.deposit`  — raw string
 *     e.g. `"~0.0052 XLM"` or numeric `"0.0052"`.  When set, no RPC is made.
 *   `pipeline.mock.wallet.stellar.networkFeeEstimate.withdraw` — same format.
 *   `pipeline.mock.wallet.stellar.networkFeeEstimate.stake`    — same format.
 *   `pipeline.mock.wallet.stellar.networkFeeEstimate.unstake`  — same format.
 *
 * The hook re-fetches every 60 s (same cadence as the EVM fee hook).
 *
 * Format: `~<value> XLM` with at least 2 and at most 5 significant decimal
 * places (trailing zeros stripped, same convention as `formatFeeEth`).
 */

import { useQuery } from "@tanstack/react-query";
import { rpc, TransactionBuilder } from "@stellar/stellar-sdk";
import { useStellarWallet } from "./useStellarWallet";
import {
  depositManagerId,
  withdrawalQueueId,
  stakedPlusdId,
  sorobanRpcUrl,
  networkPassphrase,
} from "./chain";
import { readMock, useMock, parseJson } from "../evm/mock";
import { DepositManagerClient } from "./contracts/depositManager";
import { WithdrawalQueueClient } from "./contracts/withdrawalQueue";
import { StakedPlusdClient } from "./contracts/stakedPlusd";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Mock localStorage keys for the Stellar network fee estimate. */
const STELLAR_FEE_MOCK_KEYS = {
  deposit: "pipeline.mock.wallet.stellar.networkFeeEstimate.deposit",
  withdraw: "pipeline.mock.wallet.stellar.networkFeeEstimate.withdraw",
  stake: "pipeline.mock.wallet.stellar.networkFeeEstimate.stake",
  unstake: "pipeline.mock.wallet.stellar.networkFeeEstimate.unstake",
} as const;

/**
 * Representative deposit/withdraw/stake/unstake amounts for the fee simulation
 * (7 decimals). 1000 tokens at 7 dp = 10_000_000_000n.
 */
const REPRESENTATIVE_AMOUNT = 10_000_000_000n;

// ── Types ─────────────────────────────────────────────────────────────────────

export type StellarFeeDirection = "deposit" | "withdraw" | "stake" | "unstake";

export interface UseStellarNetworkFeeEstimateResult {
  /**
   * XLM-denominated fee string, e.g. `"~0.0052 XLM"`. `undefined` when not
   * configured, loading, or disconnected.
   */
  feeXlm: string | undefined;
  /** `true` while the first query is in-flight. */
  isLoading: boolean;
  /** Any error from the estimation (not thrown — surfaced here). */
  error: Error | null;
}

// ── Format helper ─────────────────────────────────────────────────────────────

/**
 * Formats a fee in stroops (1 XLM = 10_000_000 stroops) as a `~0.0052 XLM` string.
 *
 * Rules (mirrors `formatFeeEth` conventions):
 *   - At least 2 decimal places.
 *   - At most 5 decimal places.
 *   - Trailing zeros stripped down to 2 places.
 */
export function formatFeeXlm(stroops: bigint): string {
  // 1 XLM = 10_000_000 stroops (7 decimal places)
  const xlmScale = 10_000_000n;
  const whole = stroops / xlmScale;
  const frac = stroops % xlmScale;
  const fracStr = frac.toString().padStart(7, "0");
  // Truncate to 5 decimal places
  const truncated = fracStr.slice(0, 5).padEnd(5, "0");
  // Strip trailing zeros down to 2 places
  const stripped = truncated.replace(/0+$/, "").padEnd(2, "0");
  return `~${whole}.${stripped} XLM`;
}

// ── useStellarNetworkFeeEstimate ──────────────────────────────────────────────

/**
 * Returns a representative Soroban network-fee estimate for the given
 * deposit/withdraw direction, refreshed once per minute.
 *
 * Consults the mock-key layer first; skips all RPC calls when a mock is present.
 * Returns `{ feeXlm: undefined }` when:
 *   - The relevant contract ID is empty (not configured).
 *   - The wallet is disconnected.
 *   - The simulation fails.
 */
export function useStellarNetworkFeeEstimate(
  direction: StellarFeeDirection,
): UseStellarNetworkFeeEstimateResult {
  const { address, isConnected } = useStellarWallet();

  const mockKey = STELLAR_FEE_MOCK_KEYS[direction];

  // ── Mock-key check (reactive) ─────────────────────────────────────────────
  const mockRaw = useMock(mockKey, parseJson<string>);

  const contractId =
    direction === "deposit"
      ? depositManagerId
      : direction === "withdraw"
        ? withdrawalQueueId
        : stakedPlusdId;
  const isConfigured = !!contractId;

  // ── Query function ────────────────────────────────────────────────────────

  const queryFn = async (): Promise<string | undefined> => {
    // Re-read mock at query time (covers non-reactive re-runs).
    const mockVal = readMock(mockKey, parseJson<string>);
    if (mockVal !== undefined) {
      if (mockVal.startsWith("~")) return mockVal;
      return `~${mockVal} XLM`;
    }

    if (!isConnected || !address || !isConfigured) return undefined;

    try {
      const server = new rpc.Server(sorobanRpcUrl, {
        allowHttp: sorobanRpcUrl.startsWith("http://"),
      });

      // Load a real source account (needed for sequence number in simulation).
      const sourceAccount = await server.getAccount(address);

      let assembledXdr: string;

      if (direction === "deposit") {
        const client = new DepositManagerClient(contractId);
        assembledXdr = await client.buildRequestDeposit(
          address,
          REPRESENTATIVE_AMOUNT,
          sourceAccount,
        );
      } else if (direction === "withdraw") {
        const client = new WithdrawalQueueClient(contractId);
        assembledXdr = await client.buildRequestWithdrawal(
          address,
          REPRESENTATIVE_AMOUNT,
          sourceAccount,
        );
      } else if (direction === "stake") {
        const client = new StakedPlusdClient(contractId);
        assembledXdr = await client.buildDeposit(
          address,
          REPRESENTATIVE_AMOUNT,
          address, // receiver = sender
          sourceAccount,
        );
      } else {
        // unstake
        const client = new StakedPlusdClient(contractId);
        assembledXdr = await client.buildRedeem(
          address,
          REPRESENTATIVE_AMOUNT,
          address, // receiver = sender
          sourceAccount,
        );
      }

      // Parse the assembled XDR to extract the Soroban resource fee (in stroops).
      // `buildRequestDeposit`/`buildRequestWithdrawal` returns the assembled tx
      // with the total fee (base + resource) embedded.
      const tx = TransactionBuilder.fromXDR(assembledXdr, networkPassphrase);
      const feeStroops = BigInt(tx.fee);

      return formatFeeXlm(feeStroops);
    } catch {
      // Simulation failed (unconfigured contract, bad account, etc.) — return
      // undefined so callers render "—"
      return undefined;
    }
  };

  // ── useQuery ──────────────────────────────────────────────────────────────
  const shouldRunQuery =
    mockRaw === undefined && isConfigured && isConnected && !!address;

  const query = useQuery({
    queryKey: ["stellarNetworkFeeEstimate", direction, address, contractId],
    queryFn,
    enabled: shouldRunQuery,
    refetchInterval: 60_000,
    staleTime: 60_000,
    // Do not retry on error — simulation failures are transient display-only issues.
    retry: false,
  });

  // ── Mock-key fast path ────────────────────────────────────────────────────
  if (mockRaw !== undefined) {
    const feeXlm = mockRaw.startsWith("~") ? mockRaw : `~${mockRaw} XLM`;
    return { feeXlm, isLoading: false, error: null };
  }

  // ── Not configured / disconnected ─────────────────────────────────────────
  if (!isConfigured || !isConnected || !address) {
    return { feeXlm: undefined, isLoading: false, error: null };
  }

  // ── Real path ─────────────────────────────────────────────────────────────
  return {
    feeXlm: query.data ?? undefined,
    isLoading: query.isLoading,
    error: (query.error as Error | null) ?? null,
  };
}
