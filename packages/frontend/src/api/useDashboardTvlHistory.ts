/**
 * React Query hook — fetches TVL history from the Pipeline API
 * (`GET /v1/dashboard/tvl-history`).
 *
 * The hook is always enabled (no wallet connection required — protocol-level).
 * Takes `chain_id`, `days`, and `interval` via the shared `periodToQuery` util.
 *
 * Mock layer
 * ----------
 * Before issuing a real network request, `apiFetch` checks:
 *
 *   `pipeline.mock.api.GET./v1/dashboard/tvl-history`
 *
 * When the key is present its value is parsed as JSON and returned immediately.
 *
 * See `src/api/README.md` for the full mock-key schema and DevTools snippets.
 *
 * Data-layer note
 * ---------------
 * `tvl` is a 6-decimal USDC string already in human units (e.g. `"43140000.000000"`
 * = $43.14M cumulative net inflow). No events → `200 []`.
 */
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { periodToQuery } from "@/utils/statsPeriod";
import { ENV } from "@/lib/env";

// ── Types ─────────────────────────────────────────────────────────────────────

/** One data point in the TVL history series. */
export interface TvlPoint {
  /** ISO-8601 timestamp for the start of the bucket. */
  timestamp: string;
  /**
   * Cumulative net TVL at this point in time — 6-decimal string in human units.
   * Monotonically non-decreasing.
   */
  tvl: string;
}

export interface UseDashboardTvlHistoryParams {
  chainId: number;
  periodId: string;
}

export interface UseDashboardTvlHistoryResult {
  /** Raw point array from the API; `undefined` while loading or on error. */
  data: TvlPoint[] | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Returns TVL history from `GET /v1/dashboard/tvl-history`.
 *
 * - Polls every 30 s per the dashboard "Real-time updates" convention.
 * - Period → interval mapping from the shared `periodToQuery` util.
 * - No wallet or vault address required — protocol-level endpoint.
 */
export function useDashboardTvlHistory({
  chainId,
  periodId,
}: UseDashboardTvlHistoryParams): UseDashboardTvlHistoryResult {
  const resolvedChainId = chainId || ENV.EVM_CHAIN_ID;

  const query = useQuery<TvlPoint[], Error>({
    queryKey: ["dashboard-tvl-history", resolvedChainId, periodId],
    queryFn: () => {
      const period = periodToQuery(periodId);
      const params = new URLSearchParams({
        chain_id: String(resolvedChainId),
        interval: period.interval,
      });
      if (period.days !== undefined) {
        params.set("days", String(period.days));
      }
      return apiFetch<TvlPoint[]>(
        `/v1/dashboard/tvl-history?${params.toString()}`,
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
