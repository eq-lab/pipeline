/**
 * Chart-data mapping utilities for the Yield History panel (issue #720).
 *
 * Converts raw `SampleYieldItem[]` from `GET /v1/stats/yield` into the
 * 100-bar chart shape used by `YieldBarChart`. Follows the same approach as
 * `pricesToCurve` in `usePortfolioChart.ts` — parse, sort by timestamp,
 * normalise heights against the maximum value.
 */

import type { SampleYieldItem } from "@/api/useStatsYield";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Number of bar slots rendered by the yield chart (matches home chart). */
export const YIELD_CHART_N = 100;

/** Minimum bar height percentage to keep bars visually present. */
const MIN_HEIGHT_PCT = 2;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface YieldBarPoint {
  /** Height as a percentage (0–100) of the maximum accrued value. */
  height: number;
  /** Accrued value in human-unit dollars (already parsed from 6-decimal string). */
  value: number;
  /** Unix timestamp in ms. */
  timestamp: number;
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function pickPoint(points: YieldBarPoint[], index: number): YieldBarPoint {
  if (points.length === 1) return points[0]!;
  const sourceIndex = Math.round((index / (YIELD_CHART_N - 1)) * (points.length - 1));
  return points[Math.min(points.length - 1, sourceIndex)]!;
}

/**
 * Converts an array of `SampleYieldItem` into a `YIELD_CHART_N`-slot bar
 * chart array normalised to the maximum accrued value.
 *
 * Returns `null` when the input is empty or all samples are invalid, so
 * callers can show the empty state instead of a meaningless chart.
 *
 * - Parses `accrued` as a 6-decimal USDC string (already in human units).
 * - Sorts by `timestamp` ascending (API should be sorted but we guarantee it).
 * - Normalises heights: `height = max(MIN_HEIGHT_PCT, value / max * 100)`.
 * - Maps to `YIELD_CHART_N` slots using the same `pickPoint` approach as
 *   `pricesToCurve` in `usePortfolioChart.ts`.
 */
export function accrualToBars(
  samples: SampleYieldItem[] | undefined,
): YieldBarPoint[] | null {
  const valid = (samples ?? [])
    .map((s) => {
      const value = parseFloat(s.accrued);
      const timestamp = new Date(s.timestamp).getTime();
      if (!Number.isFinite(value) || value < 0) return null;
      if (!Number.isFinite(timestamp)) return null;
      return { value, timestamp } as Omit<YieldBarPoint, "height"> & { height: 0 };
    })
    .filter((p): p is { value: number; timestamp: number; height: 0 } => p !== null)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (valid.length === 0) return null;

  const maxValue = Math.max(...valid.map((p) => p.value));
  if (!Number.isFinite(maxValue) || maxValue <= 0) return null;

  const points: YieldBarPoint[] = valid.map((p) => ({
    value: p.value,
    timestamp: p.timestamp,
    height: Math.max(MIN_HEIGHT_PCT, (p.value / maxValue) * 100),
  }));

  // Map to YIELD_CHART_N slots (resampling when API returns fewer/more points)
  return Array.from({ length: YIELD_CHART_N }, (_, index) => {
    const source = pickPoint(points, index);
    return {
      value: source.value,
      timestamp: source.timestamp,
      height: source.height,
    };
  });
}

/**
 * Returns the most recent cumulative accrued value from the samples array,
 * or `null` when the series is empty / invalid.
 *
 * The "latest" point is the one with the largest timestamp (last in sorted
 * order). The returned value is in human-unit dollars (no unit conversion
 * needed — `accrued` is already a 6-decimal decimal string).
 */
export function latestAccrued(
  samples: SampleYieldItem[] | undefined,
): number | null {
  if (!samples || samples.length === 0) return null;

  let latest: { value: number; timestamp: number } | null = null;
  for (const s of samples) {
    const value = parseFloat(s.accrued);
    const timestamp = new Date(s.timestamp).getTime();
    if (!Number.isFinite(value) || !Number.isFinite(timestamp)) continue;
    if (latest === null || timestamp > latest.timestamp) {
      latest = { value, timestamp };
    }
  }

  return latest !== null ? latest.value : null;
}
