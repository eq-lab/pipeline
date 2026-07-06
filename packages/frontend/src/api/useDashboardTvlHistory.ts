/**
 * React Query hook — fetches TVL history from the Pipeline API
 * (`GET /v1/dashboard/tvl-history`).
 *
 * The hook is always enabled (no wallet connection required — protocol-level).
 * Fetches the full history (omits `days`) at the backend default `daily`
 * interval (omits `interval`) — the dashboard charts render daily data.
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
 * - Full history at the default daily interval (both query params omitted).
 * - No wallet or vault address required — protocol-level endpoint.
 */
export function useDashboardTvlHistory({
  chainId,
}: UseDashboardTvlHistoryParams): UseDashboardTvlHistoryResult {
  const resolvedChainId = chainId || ENV.EVM_CHAIN_ID;

  const query = useQuery<TvlPoint[], Error>({
    queryKey: ["dashboard-tvl-history", resolvedChainId],
    queryFn: () => {
      // Full history (omit `days`) at the backend default daily interval
      // (omit `interval`) — charts render daily data.
      const params = new URLSearchParams({ chain_id: String(resolvedChainId) });
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
