/**
 * React Query hook — fetches the Capital Allocation breakdown
 * (`GET /v1/capital-allocation`) for the Trustee Overview page's Capital
 * Allocation card. Mirrors the LP frontend's `useDashboardSummary` pattern —
 * see `packages/frontend/src/api/useDashboardSummary.ts`.
 *
 * spec: docs/frontend/trustee-flows.md#capital-allocation-card--data-layer
 * (base-6 unit scale, null-bucket handling).
 */
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { ENV } from "@/lib/env";
import { useSessionState } from "@/auth/sessionStore";

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
  /** The chain the breakdown was requested for (the session's chain, #1601). */
  chainId: number;
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
 * - Sends the chain the trustee signed in with (#1601; omitted would mean every
 *   configured chain since #1586, and the card describes one chain's custody).
 */
export function useCapitalAllocation(): UseCapitalAllocationResult {
  const chainId = useSessionState().chainId ?? ENV.STELLAR_CHAIN_ID;

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
    chainId,
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}
