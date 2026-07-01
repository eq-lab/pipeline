/**
 * React Query hook — fetches cumulative yield history from the Pipeline API
 * (`GET /v1/stats/yield`).
 *
 * The hook is always enabled when a valid chain_id is available — no wallet
 * connection required (these are protocol-level stats visible to everyone).
 *
 * Mock layer
 * ----------
 * Before issuing a real network request, `apiFetch` checks:
 *
 *   `pipeline.mock.api.GET./v1/stats/yield`
 *
 * When the key is present its value is parsed as JSON and returned immediately.
 *
 * See `src/api/README.md` for the full mock-key schema and DevTools snippets.
 *
 * Data-layer note
 * ---------------
 * `accrued` is a 6-decimal USDC string (already in human units, e.g.
 * `"2910000.000000"` = $2.91M cumulative senior interest). `apy` is a decimal
 * fraction string (e.g. `"0.104"` = 10.4%); may be `null` when there is
 * insufficient history.
 */
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { periodToQuery } from "@/utils/statsPeriod";

// ── Types ─────────────────────────────────────────────────────────────────────

/** One data point in the yield history series. */
export interface SampleYieldItem {
  /** ISO-8601 timestamp for the start of the bucket. */
  timestamp: string;
  /**
   * Blended APY for the period as a decimal-fraction string (e.g. `"0.104"`).
   * `null` when there is insufficient history (e.g. no active loans).
   */
  apy: string | null;
  /**
   * Cumulative senior interest accrued, USDC — 6-decimal string in human units
   * (e.g. `"2910000.000000"` = $2.91 M).
   * Monotonically non-decreasing in `timestamp`.
   */
  accrued: string;
  /**
   * Outstanding senior principal at this point in time — 6-decimal human units.
   */
  principal_outstanding: string;
}

export interface UseStatsYieldParams {
  chainId: number;
  periodId: string;
  /** When `false` the query will not fire (e.g. vault address is zero). */
  enabled?: boolean;
}

export interface UseStatsYieldResult {
  /** Raw sample array from the API; `undefined` while loading or on error. */
  data: SampleYieldItem[] | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Returns cumulative yield + APY history from `GET /v1/stats/yield`.
 *
 * - Polls every 30 s per the dashboard "Real-time updates" convention.
 * - Degrades to empty state when `enabled = false` (zero-address vault guard).
 * - Period → interval mapping from the shared `periodToQuery` util.
 */
export function useStatsYield({
  chainId,
  periodId,
  enabled = true,
}: UseStatsYieldParams): UseStatsYieldResult {
  const query = useQuery<SampleYieldItem[], Error>({
    queryKey: ["stats-yield", chainId, periodId],
    queryFn: () => {
      const period = periodToQuery(periodId);
      const params = new URLSearchParams({
        chain_id: String(chainId),
        interval: period.interval,
      });
      if (period.days !== undefined) {
        params.set("days", String(period.days));
      }
      return apiFetch<SampleYieldItem[]>(`/v1/stats/yield?${params.toString()}`);
    },
    enabled,
    refetchInterval: 30_000,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}
