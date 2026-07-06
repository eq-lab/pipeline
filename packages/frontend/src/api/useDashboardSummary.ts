/**
 * React Query hook — fetches the dashboard summary KPIs from the Pipeline API
 * (`GET /v1/dashboard/summary`).
 *
 * The hook is always enabled (no wallet connection required — this is a
 * protocol-level view visible to everyone). Takes only `chain_id`.
 *
 * Mock layer
 * ----------
 * Before issuing a real network request, `apiFetch` checks:
 *
 *   `pipeline.mock.api.GET./v1/dashboard/summary`
 *
 * When the key is present its value is parsed as JSON and returned immediately.
 *
 * See `src/api/README.md` for the full mock-key schema and DevTools snippets.
 *
 * Data-layer note
 * ---------------
 * USDC amounts (`tvl`, `outstanding_in_loans`, `cumulative_yield_total`) are
 * 6-decimal strings already in human units (e.g. `"43140000.000000"` = $43.14M).
 * Rates (`current_apy_net_to_splusd`, `loan_book_yield`) are decimal-fraction
 * strings (e.g. `"0.104"` = 10.4%). Unavailable fields are `null`.
 */
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { ENV } from "@/lib/env";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Dashboard summary KPIs from `GET /v1/dashboard/summary`. */
export interface DashboardSummary {
  /**
   * Total value locked (net cumulative inflows) — 6-decimal string in human
   * units (e.g. `"43140000.000000"` = $43.14 M). Non-null when there are any
   * flow events; may be `null` on a fresh protocol with no deposits.
   */
  tvl: string;
  /**
   * Outstanding principal in active loans — 6-decimal string in human units.
   * `null` when no active loans.
   */
  outstanding_in_loans: string | null;
  /**
   * Current net APY delivered to sPLUSD holders — decimal-fraction string
   * (e.g. `"0.104"` = 10.4%). `null` when no active loans.
   */
  current_apy_net_to_splusd: string | null;
  /**
   * Principal-weighted gross senior rate — decimal-fraction string.
   * `null` when no active loans.
   */
  loan_book_yield: string | null;
  /**
   * Cumulative net yield minted to sPLUSD — 6-decimal string in human units.
   * Equals the final point of the yield-history series.
   */
  cumulative_yield_total: string;
}

export interface UseDashboardSummaryResult {
  /** Raw summary from the API; `undefined` while loading or on error. */
  data: DashboardSummary | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Returns the five dashboard headline KPIs from `GET /v1/dashboard/summary`.
 *
 * - Polls every 30 s per the dashboard "Real-time updates" convention.
 * - No vault address required — protocol-level endpoint.
 */
export function useDashboardSummary(): UseDashboardSummaryResult {
  // The Protocol Dashboard is Stellar-scoped: its real/tested data lives on the
  // Stellar chain (99000001). The EVM chain (560048/Hoodi) carries malformed test
  // data (see #765), so the dashboard queries Stellar.
  const chainId = ENV.STELLAR_CHAIN_ID;

  const query = useQuery<DashboardSummary, Error>({
    queryKey: ["dashboard-summary", chainId],
    queryFn: () => {
      const params = new URLSearchParams({
        chain_id: String(chainId),
      });
      return apiFetch<DashboardSummary>(
        `/v1/dashboard/summary?${params.toString()}`,
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
