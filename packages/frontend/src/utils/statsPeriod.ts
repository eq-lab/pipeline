/**
 * Shared period → API query param mapping used by both `useStatsPrices` and
 * `useStatsYield`. Extracted so neither hook duplicates the logic.
 *
 * See FRONTEND.md rule 3: helpers used in two or more places belong in
 * `packages/frontend/src/utils/`.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type StatsPricesInterval = "hourly" | "daily" | "weekly";

export interface StatsPeriodQuery {
  days?: number;
  interval: StatsPricesInterval;
}

// ── Period map ────────────────────────────────────────────────────────────────

/**
 * Canonical period-id labels used by the time-range SegmentedTabs on stats
 * charts (PortfolioPlaceholderCard, YieldHistoryPanel, etc.).
 */
export const STATS_PERIODS = [
  { id: "7d", label: "7D" },
  { id: "1m", label: "1M" },
  { id: "3m", label: "3M" },
  { id: "1y", label: "1Y" },
  { id: "all", label: "All" },
] as const;

export type StatsPeriodId = (typeof STATS_PERIODS)[number]["id"];

/**
 * Maps a time-range period id to the API query parameters for
 * `/v1/stats/prices` and `/v1/stats/yield`.
 *
 * - "all" omits `days` and uses weekly interval to avoid the 1000-sample 400.
 * - Unknown ids fall back to the "all" (weekly) behaviour.
 */
export function periodToQuery(periodId: string): StatsPeriodQuery {
  switch (periodId) {
    case "7d":
      return { days: 7, interval: "hourly" };
    case "1m":
      return { days: 30, interval: "daily" };
    case "3m":
      return { days: 90, interval: "daily" };
    case "1y":
      return { days: 365, interval: "daily" };
    case "all":
    default:
      // Omit `days` → full history; weekly to stay under the 1000-sample limit.
      return { interval: "weekly" };
  }
}
