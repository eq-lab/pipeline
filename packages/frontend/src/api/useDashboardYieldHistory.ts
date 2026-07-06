/**
 * React Query hook — fetches cumulative yield history from the Pipeline API
 * (`GET /v1/dashboard/yield-history`).
 *
 * This endpoint serves the **net minted** yield series (Σ `YieldMinted.s_plusd_amount`),
 * distinct from `GET /v1/stats/yield` which is a gross accrual estimate. The final
 * point equals `summary.cumulative_yield_total`.
 *
 * The hook is always enabled (no wallet connection required — protocol-level).
 * Fetches the full history (omits `days`) at the backend default `daily`
 * interval (omits `interval`) — the dashboard charts render daily data.
 *
 * Mock layer
 * ----------
 * Before issuing a real network request, `apiFetch` checks:
 *
 *   `pipeline.mock.api.GET./v1/dashboard/yield-history`
 *
 * When the key is present its value is parsed as JSON and returned immediately.
 *
 * See `src/api/README.md` for the full mock-key schema and DevTools snippets.
 *
 * Data-layer note
 * ---------------
 * `cumulative_yield` is a 6-decimal USDC string already in human units (e.g.
 * `"2910000.000000"` = $2.91M cumulative yield). No events → `200 []`.
 */
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { ENV } from "@/lib/env";

// ── Types ─────────────────────────────────────────────────────────────────────

/** One data point in the yield history series. */
export interface YieldPoint {
  /** ISO-8601 timestamp for the start of the bucket. */
  timestamp: string;
  /**
   * Cumulative net yield minted to sPLUSD at this point — 6-decimal string in
   * human units. Monotonically non-decreasing.
   */
  cumulative_yield: string;
}

export interface UseDashboardYieldHistoryParams {
  chainId: number;
}

export interface UseDashboardYieldHistoryResult {
  /** Raw point array from the API; `undefined` while loading or on error. */
  data: YieldPoint[] | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Returns cumulative yield history from `GET /v1/dashboard/yield-history`.
 *
 * - Polls every 30 s per the dashboard "Real-time updates" convention.
 * - Full history at the default daily interval (both query params omitted).
 * - No wallet or vault address required — protocol-level endpoint.
 */
export function useDashboardYieldHistory({
  chainId,
}: UseDashboardYieldHistoryParams): UseDashboardYieldHistoryResult {
  const resolvedChainId = chainId || ENV.STELLAR_CHAIN_ID;

  const query = useQuery<YieldPoint[], Error>({
    queryKey: ["dashboard-yield-history", resolvedChainId],
    queryFn: () => {
      // Full history (omit `days`) at the backend default daily interval
      // (omit `interval`) — charts render daily data.
      const params = new URLSearchParams({ chain_id: String(resolvedChainId) });
      return apiFetch<YieldPoint[]>(
        `/v1/dashboard/yield-history?${params.toString()}`,
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
