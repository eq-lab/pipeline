/**
 * React Query hook — fetches cumulative yield history from the Pipeline API
 * (`GET /v1/dashboard/yield-history`).
 *
 * This endpoint serves the **net minted** yield series (Σ `YieldMinted.s_plusd_amount`),
 * distinct from `GET /v1/stats/yield` which is a gross accrual estimate. The final
 * point equals `summary.cumulative_yield_total`.
 *
 * The hook is always enabled (no wallet connection required — protocol-level).
 * Takes `chain_id`, `days`, and `interval` via the shared `periodToQuery` util.
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
import { periodToQuery } from "@/utils/statsPeriod";
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
  periodId: string;
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
 * - Period → interval mapping from the shared `periodToQuery` util.
 * - No wallet or vault address required — protocol-level endpoint.
 */
export function useDashboardYieldHistory({
  chainId,
  periodId,
}: UseDashboardYieldHistoryParams): UseDashboardYieldHistoryResult {
  const resolvedChainId = chainId || ENV.EVM_CHAIN_ID;

  const query = useQuery<YieldPoint[], Error>({
    queryKey: ["dashboard-yield-history", resolvedChainId, periodId],
    queryFn: () => {
      const period = periodToQuery(periodId);
      const params = new URLSearchParams({
        chain_id: String(resolvedChainId),
        interval: period.interval,
      });
      if (period.days !== undefined) {
        params.set("days", String(period.days));
      }
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
