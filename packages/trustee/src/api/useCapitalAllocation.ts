/**
 * React Query hook — fetches the Capital Allocation breakdown from the
 * Pipeline API (`GET /v1/capital-allocation`) for the Trustee Overview page's
 * Capital Allocation card (issue #797).
 *
 * Mirrors the LP frontend's `useDashboardSummary` pattern (queryKey, `apiFetch`,
 * `URLSearchParams`, `refetchInterval`) — see
 * `packages/frontend/src/api/useDashboardSummary.ts`.
 *
 * The Overview page is Stellar-scoped, like the LP Protocol Dashboard: the
 * EVM chain (560048/Hoodi) carries malformed test data (#765), so this hook
 * always sends `chain_id=ENV.STELLAR_CHAIN_ID` explicitly rather than relying
 * on the endpoint's `DEFAULT_CHAIN_ID` fallback.
 *
 * Data-layer note
 * ---------------
 * Every bucket and `total` is a base-6 decimal string already in human units
 * (e.g. `"96000000.000000"` = $96M), or `null` when the backend has no source
 * for that field yet (see `packages/api/src/routes/capital_allocation.rs` —
 * today only `deployed` is sourced from the indexer). Render `—` for `null`;
 * never derive a value client-side (per [no frontend-computed metrics]).
 */
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { ENV } from "@/lib/env";

// ── Types ─────────────────────────────────────────────────────────────────────

/** The Capital Allocation buckets from `GET /v1/capital-allocation`. All fields nullable. */
export interface CapitalBuckets {
  /** Capital-Wallet USDC, idle. `null` when not yet indexed. */
  capital_wallet: string | null;
  /** Funds converting at providers (on/off-ramp). `null` when not yet indexed. */
  in_transit: string | null;
  /**
   * The Withdrawal Queue Wallet's current USDC balance (backend #933,
   * rendered per #1020). `null` when no queue wallet is configured for the
   * chain. Included in the served `total` when present.
   */
  withdrawal_queue: string | null;
  /** USD residuals held in the trust account. `null` when not yet indexed. */
  trust_account: string | null;
  /** Σ senior tranche over active loans. `null` when not yet indexed. */
  deployed: string | null;
  /** USYC / T-Bills holding valued at issuer NAV. `null` when not yet indexed. */
  tbills: string | null;
}

/** Response body for `GET /v1/capital-allocation`. */
export interface CapitalAllocation {
  /** Σ of the available buckets; `null` when no bucket is populated. */
  total: string | null;
  buckets: CapitalBuckets;
}

export interface UseCapitalAllocationResult {
  /** Raw response from the API; `undefined` while loading or on error. */
  data: CapitalAllocation | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Returns the Capital Allocation breakdown from `GET /v1/capital-allocation`.
 *
 * - Polls every 30 s per the dashboard "Real-time updates" convention.
 * - Always sends `chain_id=ENV.STELLAR_CHAIN_ID` — the Overview page is
 *   Stellar-scoped like the LP Protocol Dashboard.
 */
export function useCapitalAllocation(): UseCapitalAllocationResult {
  const chainId = ENV.STELLAR_CHAIN_ID;

  const query = useQuery<CapitalAllocation, Error>({
    queryKey: ["capital-allocation", chainId],
    queryFn: () => {
      const params = new URLSearchParams({
        chain_id: String(chainId),
      });
      return apiFetch<CapitalAllocation>(
        `/v1/capital-allocation?${params.toString()}`,
      );
    },
    refetchInterval: 30_000,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}
