/**
 * React Query hook — reads the Capital Wallet's USDC balance directly from
 * the Stellar contract (on-chain), as an interim source for the Overview
 * page's Capital Allocation card until the backend indexes `capital_wallet`.
 *
 * Read path: a thin `useQuery` wrapper around `@pipeline/wallet-connect`'s
 * `getSacBalance` — a plain async function (that package forbids
 * `@tanstack/react-query` outside `src/evm/**`). The Trustee cannot import
 * `@stellar/stellar-sdk` directly (TD-33, no carve-out), so all Soroban read
 * machinery lives in the shared package; this file only wires env values in
 * and scales/guards the result for display.
 *
 * spec: docs/frontend/trustee-flows.md#capital-allocation-card--data-layer
 * (mapping, scale conversion, sentinel guard — all TD-41).
 */
import { useQuery } from "@tanstack/react-query";
import { getSacBalance } from "@pipeline/wallet-connect";
import { ENV } from "@/lib/env";

/** Stellar SAC standard decimal count (matches the LP's `SAC_DECIMALS`). */
const SAC_DECIMALS = 7;

/**
 * Converts a raw i128 bigint (7-decimal fixed-point) to a human-readable
 * decimal string, matching the shape of the backend's base-6 bucket strings.
 * Example: `sacRawToDisplay(10_000_000n)` → `"1.0000000"`.
 */
function sacRawToDisplay(raw: bigint, decimals: number = SAC_DECIMALS): string {
  const factor = BigInt(10 ** decimals);
  const whole = raw / factor;
  const frac = raw % factor;
  const fracStr = frac.toString().padStart(decimals, "0");
  return `${whole}.${fracStr}`;
}

export interface UseCapitalWalletBalanceResult {
  /**
   * Human-decimal string (e.g. `"8400000.0000000"`), same shape as the
   * backend's base-6 bucket strings — feed directly into
   * `formatCompactUsd`/`formatFullUsd` or `parseFloat()` for summing.
   * `undefined` while loading, unconfigured, or on read failure/sentinel.
   */
  data: string | undefined;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Reads the Capital Wallet's on-chain USDC balance via
 * `usdc.balance(ENV.STELLAR_USDC_CUSTODY_ID)`.
 *
 * Returns `{ data: undefined, isLoading: false, error: null }` when
 * `ENV.STELLAR_USDC_ID` or `ENV.STELLAR_USDC_CUSTODY_ID` is unset (no RPC
 * call is made) — never fabricates a value.
 */
export function useCapitalWalletBalance(): UseCapitalWalletBalanceResult {
  const isConfigured = !!ENV.STELLAR_USDC_ID && !!ENV.STELLAR_USDC_CUSTODY_ID;

  const query = useQuery<string, Error>({
    queryKey: [
      "capitalWalletBalance",
      ENV.STELLAR_RPC_URL,
      ENV.STELLAR_USDC_ID,
      ENV.STELLAR_USDC_CUSTODY_ID,
    ],
    queryFn: async () => {
      const raw = await getSacBalance({
        sorobanRpcUrl: ENV.STELLAR_RPC_URL,
        networkPassphrase: ENV.STELLAR_NETWORK_PASSPHRASE,
        sacContractId: ENV.STELLAR_USDC_ID,
        account: ENV.STELLAR_USDC_CUSTODY_ID,
      });
      return sacRawToDisplay(raw);
    },
    enabled: isConfigured,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: false,
  });

  if (!isConfigured) {
    return { data: undefined, isLoading: false, error: null };
  }

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error ?? null,
  };
}
