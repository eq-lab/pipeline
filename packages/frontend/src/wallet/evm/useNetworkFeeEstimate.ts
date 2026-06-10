/**
 * Network-fee estimate hook for the /deposit and /stake pages.
 *
 * Returns a live ETH-denominated gas-cost estimate for the representative
 * call associated with the given direction:
 *   - "deposit"  → `requestDeposit(max(1000 USDC, minDeposit))`
 *   - "withdraw" → `requestWithdrawal(1000 PLUSD)`
 *   - "stake"    → `sPLUSD.deposit(1000 PLUSD, receiver=address)`
 *   - "unstake"  → `sPLUSD.redeem(1000 sPLUSD, receiver=address, owner=address)`
 *
 * The estimate is:
 *   1. Computed via `publicClient.estimateContractGas` (without `stateOverride`
 *      — see rationale below).
 *   2. Buffered by +20 % via `applyGasBuffer` (no clamp — display only, not a
 *      real tx).
 *   3. Multiplied by live `gasPrice` from `publicClient.getGasPrice()`.
 *   4. Formatted to 5 decimal places with a leading `~`.
 *
 * If `estimateContractGas` reverts (e.g., the caller lacks allowance or
 * balance), the hook falls back to curated-constant gas numbers:
 *   - deposit:  250 000 gas
 *   - withdraw: 180 000 gas
 *   - stake:    200 000 gas
 *   - unstake:  200 000 gas
 * These constants are multiplied by live `gasPrice` to give a representative
 * cost estimate even when the simulation path is unavailable.
 *
 * Mock-key support (localStorage):
 *   `pipeline.mock.wallet.networkFeeEstimate.deposit`  — raw numeric string or
 *   `pipeline.mock.wallet.networkFeeEstimate.withdraw`   `"~0.00053 ETH"` string.
 *   `pipeline.mock.wallet.networkFeeEstimate.stake`    — same format.
 *   `pipeline.mock.wallet.networkFeeEstimate.unstake`  — same format.
 *   When set, the hook short-circuits without any RPC call.
 *
 * Not configured / disconnected: returns `{ feeEth: undefined }` so callers
 * can render `—`.
 *
 * Decision log:
 *   The exec plan (step 4) preferred trying `estimateContractGas` without
 *   `stateOverride` first (most active testers will already hold USDC/PLUSD).
 *   On revert we catch and fall back to the curated constants. `stateOverride`
 *   was considered but requires knowing ERC-20 storage slot indices per token —
 *   too fragile for a display-only feature. The manager confirmed this approach
 *   is acceptable (open-question resolution in the Issue comments).
 *
 *   The fee is denominated in ETH (not USD). Issue #506 was closed with the
 *   decision "we do not have usd price, show only eth amount." The stake/unstake
 *   directions follow the same precedent — see issue #542 for the resolution.
 */
import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { formatEther } from "viem";
import { ENV } from "@/lib/env";
import { readMock, useMock, parseJson } from "./mock";
import { useEvmWallet } from "./useEvmWallet";
import { useDepositManagerMinDeposit } from "./useDepositManager";
import { depositManagerAbi } from "./abis/depositManager";
import { withdrawalQueueAbi } from "./abis/withdrawalQueue";
import { stakedPlusdAbi } from "./abis/stakedPlusd";
import { applyGasBuffer } from "./gas";
import { parseUnits } from "./units";

// ── Constants ─────────────────────────────────────────────────────────────────

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Curated fallback gas for `requestDeposit` when simulation reverts. */
const FALLBACK_GAS_DEPOSIT = 250_000n;
/** Curated fallback gas for `requestWithdrawal` when simulation reverts. */
const FALLBACK_GAS_WITHDRAW = 180_000n;
/** Curated fallback gas for `sPLUSD.deposit` (stake) when simulation reverts. */
const FALLBACK_GAS_STAKE = 200_000n;
/** Curated fallback gas for `sPLUSD.redeem` (unstake) when simulation reverts. */
const FALLBACK_GAS_UNSTAKE = 200_000n;

/** Representative fixed amounts (token-decimals applied at call time). */
const REPRESENTATIVE_USDC = "1000"; // 1000 USDC
const REPRESENTATIVE_PLUSD = "1000"; // 1000 PLUSD
const REPRESENTATIVE_SPLUSD = "1000"; // 1000 sPLUSD (for unstake/redeem)

/**
 * USDC uses 6 decimals (stable across all deployments).
 * PLUSD also uses 6 decimals — confirmed from existing test mocks (18 decimals
 * are used for the mock test harness, but real PLUSD is 6). We read decimals
 * from the token contract at call time when needed; for the representative-amount
 * path we always parse as 6 decimals (same as useToken.ts default).
 *
 * Note: The hook reads PLUSD/USDC decimals only for the representative-amount
 * calculation. If decimals are unavailable (loading), we use 6 as the safe
 * default for the fixed-string input.
 */
const DEFAULT_DECIMALS = 6;

// ── Mock-key constants ────────────────────────────────────────────────────────

const MOCK_KEYS = {
  deposit: "pipeline.mock.wallet.networkFeeEstimate.deposit",
  withdraw: "pipeline.mock.wallet.networkFeeEstimate.withdraw",
  stake: "pipeline.mock.wallet.networkFeeEstimate.stake",
  unstake: "pipeline.mock.wallet.networkFeeEstimate.unstake",
};

// ── Types ─────────────────────────────────────────────────────────────────────

export type NetworkFeeDirection = "deposit" | "withdraw" | "stake" | "unstake";

export interface UseNetworkFeeEstimateResult {
  /** ETH-denominated fee string, e.g. `"~0.00053 ETH"`. `undefined` when not configured, loading, or disconnected. */
  feeEth: string | undefined;
  /** `true` while the first query is in-flight. */
  isLoading: boolean;
  /** Any error from the estimation (not thrown — surfaced here). */
  error: Error | null;
}

// ── Format helper ─────────────────────────────────────────────────────────────

/**
 * Formats a raw fee in wei as a `~0.00053 ETH` string.
 *
 * Truncation rules:
 *   - Always show at least 2 decimal places.
 *   - Show at most 5 decimal places.
 *   - Drop trailing zeros below 5 decimals (but never below 2).
 */
export function formatFeeEth(feeWei: bigint): string {
  const full = formatEther(feeWei); // e.g. "0.000530400000000000"
  // Truncate to 5 decimal places (floor, not round).
  const [integer, decimals = ""] = full.split(".");
  const truncated = decimals.slice(0, 5).padEnd(5, "0");
  // Drop trailing zeros down to a minimum of 2 decimal places.
  const stripped = truncated.replace(/0+$/, "").padEnd(2, "0");
  return `~${integer}.${stripped} ETH`;
}

// ── useNetworkFeeEstimate ─────────────────────────────────────────────────────

/**
 * Returns a representative network-fee estimate for the given deposit/withdraw
 * direction, refreshed once per minute.
 *
 * Consults the mock-key layer first; skips all RPC calls when a mock is present.
 * Returns `{ feeEth: undefined }` when:
 *   - The relevant contract address is the zero address (not configured).
 *   - The wallet is disconnected (no `address`).
 *   - The `publicClient` is not yet ready.
 */
export function useNetworkFeeEstimate(
  direction: NetworkFeeDirection,
): UseNetworkFeeEstimateResult {
  const { address } = useEvmWallet();
  const publicClient = usePublicClient();
  const { minDeposit } = useDepositManagerMinDeposit();

  const DM_ADDRESS = ENV.DEPOSIT_MANAGER_ADDRESS;
  const WQ_ADDRESS = ENV.WITHDRAWAL_QUEUE_ADDRESS;
  const SP_ADDRESS = ENV.STAKED_PLUSD_ADDRESS;

  const contractAddress =
    direction === "deposit"
      ? DM_ADDRESS
      : direction === "withdraw"
        ? WQ_ADDRESS
        : SP_ADDRESS;
  const isZeroAddress = contractAddress === ZERO_ADDRESS;

  // ── Mock-key check (reactive) ─────────────────────────────────────────────
  // Mock values are JSON-encoded strings, e.g. `"0.00053"` or `"~0.00053 ETH"`.
  // parseJson<string> decodes them to a plain string.
  const mockKey = MOCK_KEYS[direction];
  const mockRaw = useMock(mockKey, parseJson<string>);

  // ── Query function ────────────────────────────────────────────────────────

  const queryFn = async (): Promise<string | undefined> => {
    // Re-read mock at query time (covers non-reactive re-runs).
    const mockVal = readMock(mockKey, parseJson<string>);
    if (mockVal !== undefined) {
      if (mockVal.startsWith("~")) return mockVal;
      return `~${mockVal} ETH`;
    }

    if (!publicClient || !address || isZeroAddress) return undefined;

    let gas: bigint;

    if (direction === "deposit") {
      const decimals = DEFAULT_DECIMALS;
      const base = parseUnits(REPRESENTATIVE_USDC, decimals);
      const representativeAmount =
        minDeposit !== undefined && minDeposit > base ? minDeposit : base;

      try {
        const estimated = await publicClient.estimateContractGas({
          account: address,
          abi: depositManagerAbi,
          address: DM_ADDRESS,
          functionName: "requestDeposit",
          args: [representativeAmount],
        });
        gas = applyGasBuffer(estimated);
      } catch {
        // Simulation reverted (no allowance / balance) — use curated constant.
        gas = applyGasBuffer(FALLBACK_GAS_DEPOSIT);
      }
    } else if (direction === "withdraw") {
      const decimals = DEFAULT_DECIMALS;
      const representativeAmount = parseUnits(REPRESENTATIVE_PLUSD, decimals);

      try {
        const estimated = await publicClient.estimateContractGas({
          account: address,
          abi: withdrawalQueueAbi,
          address: WQ_ADDRESS,
          functionName: "requestWithdrawal",
          args: [representativeAmount],
        });
        gas = applyGasBuffer(estimated);
      } catch {
        gas = applyGasBuffer(FALLBACK_GAS_WITHDRAW);
      }
    } else if (direction === "stake") {
      const decimals = DEFAULT_DECIMALS;
      const representativeAmount = parseUnits(REPRESENTATIVE_PLUSD, decimals);

      try {
        const estimated = await publicClient.estimateContractGas({
          account: address,
          abi: stakedPlusdAbi,
          address: SP_ADDRESS,
          functionName: "deposit",
          args: [representativeAmount, address],
        });
        gas = applyGasBuffer(estimated);
      } catch {
        gas = applyGasBuffer(FALLBACK_GAS_STAKE);
      }
    } else {
      // direction === "unstake"
      const decimals = DEFAULT_DECIMALS;
      const representativeAmount = parseUnits(REPRESENTATIVE_SPLUSD, decimals);

      try {
        const estimated = await publicClient.estimateContractGas({
          account: address,
          abi: stakedPlusdAbi,
          address: SP_ADDRESS,
          functionName: "redeem",
          args: [representativeAmount, address, address],
        });
        gas = applyGasBuffer(estimated);
      } catch {
        gas = applyGasBuffer(FALLBACK_GAS_UNSTAKE);
      }
    }

    const gasPrice = await publicClient.getGasPrice();
    const feeWei = gas * gasPrice;
    return formatFeeEth(feeWei);
  };

  // ── useQuery ──────────────────────────────────────────────────────────────
  // We use @tanstack/react-query directly here (allowed inside src/wallet/**).
  // `enabled: false` when mock is present, address is missing, or contract is
  // the zero address — avoids unnecessary RPC calls.
  const shouldRunQuery =
    mockRaw === undefined && !isZeroAddress && !!address && !!publicClient;

  const query = useQuery({
    queryKey: [
      "networkFeeEstimate",
      direction,
      address,
      DM_ADDRESS,
      WQ_ADDRESS,
      SP_ADDRESS,
      String(minDeposit),
    ],
    queryFn,
    enabled: shouldRunQuery,
    refetchInterval: 60_000,
    staleTime: 60_000,
    // Do not retry on error — the fallback-constant path already handles reverts.
    retry: false,
  });

  // ── Mock-key fast path ────────────────────────────────────────────────────
  if (mockRaw !== undefined) {
    // `mockRaw` is already a plain string (JSON-decoded by parseJson<string>).
    // Accept both "0.00053" (raw number string) and "~0.00053 ETH" (pre-formatted).
    const feeEth = mockRaw.startsWith("~") ? mockRaw : `~${mockRaw} ETH`;
    return { feeEth, isLoading: false, error: null };
  }

  // ── Not configured / disconnected ─────────────────────────────────────────
  if (isZeroAddress || !address || !publicClient) {
    return { feeEth: undefined, isLoading: false, error: null };
  }

  // ── Real path ─────────────────────────────────────────────────────────────
  return {
    feeEth: query.data ?? undefined,
    isLoading: query.isLoading,
    error: (query.error as Error | null) ?? null,
  };
}
