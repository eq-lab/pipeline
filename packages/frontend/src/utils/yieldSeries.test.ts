/**
 * Tests for `src/utils/yieldSeries.ts`.
 *
 * Covers:
 *   - `accrualToBars`: empty → null, single point, multi-point normalisation,
 *     height floor, invalid/non-numeric samples are skipped.
 *   - `latestAccrued`: empty → null, single point, latest by timestamp.
 */
import { describe, it, expect } from "vitest";
import {
  accrualToBars,
  latestAccrued,
  pointsToBars,
  YIELD_CHART_N,
} from "./yieldSeries";
import type { SampleYieldItem } from "@/api/useStatsYield";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSample(
  timestampIso: string,
  accrued: string,
  apy: string | null = "0.104",
): SampleYieldItem {
  return {
    timestamp: timestampIso,
    apy,
    accrued,
    principal_outstanding: "30000000.000000",
  };
}

// ── accrualToBars ─────────────────────────────────────────────────────────────

describe("accrualToBars", () => {
  it("returns null for undefined input", () => {
    expect(accrualToBars(undefined)).toBeNull();
  });

  it("returns null for empty array", () => {
    expect(accrualToBars([])).toBeNull();
  });

  it("returns null when all samples have zero accrued", () => {
    // maxValue would be 0 → we return null
    const samples = [makeSample("2025-01-01T00:00:00Z", "0.000000")];
    expect(accrualToBars(samples)).toBeNull();
  });

  it("returns YIELD_CHART_N bars for a single valid sample", () => {
    const samples = [makeSample("2025-01-01T00:00:00Z", "1000000.000000")];
    const bars = accrualToBars(samples);
    expect(bars).not.toBeNull();
    expect(bars).toHaveLength(YIELD_CHART_N);
  });

  it("all bars from a single sample have height >= 2 (floor)", () => {
    const samples = [makeSample("2025-01-01T00:00:00Z", "1000000.000000")];
    const bars = accrualToBars(samples)!;
    for (const bar of bars) {
      expect(bar.height).toBeGreaterThanOrEqual(2);
    }
  });

  it("the last bar has height = 100 when accrued is monotone and max is last", () => {
    // When values are monotonically increasing, the last value is the max.
    const samples = [
      makeSample("2025-01-01T00:00:00Z", "1000000.000000"),
      makeSample("2025-01-08T00:00:00Z", "2000000.000000"),
      makeSample("2025-01-15T00:00:00Z", "3000000.000000"),
    ];
    const bars = accrualToBars(samples)!;
    // The last bar should map to the last sample (3000000) → 100%
    expect(bars[YIELD_CHART_N - 1]!.height).toBe(100);
  });

  it("normalises heights to 0–100 range", () => {
    const samples = [
      makeSample("2025-01-01T00:00:00Z", "1000000.000000"),
      makeSample("2025-01-08T00:00:00Z", "2000000.000000"),
    ];
    const bars = accrualToBars(samples)!;
    for (const bar of bars) {
      expect(bar.height).toBeGreaterThanOrEqual(2);
      expect(bar.height).toBeLessThanOrEqual(100);
    }
  });

  it("skips samples with non-numeric accrued", () => {
    const samples: SampleYieldItem[] = [
      makeSample("2025-01-01T00:00:00Z", "bad"),
      makeSample("2025-01-08T00:00:00Z", "1000000.000000"),
    ];
    const bars = accrualToBars(samples);
    // Only one valid sample remains — should still return bars
    expect(bars).not.toBeNull();
    expect(bars).toHaveLength(YIELD_CHART_N);
  });

  it("skips samples with invalid timestamps", () => {
    const samples: SampleYieldItem[] = [
      {
        timestamp: "not-a-date",
        apy: "0.1",
        accrued: "1000000.000000",
        principal_outstanding: "30000000.000000",
      },
      makeSample("2025-01-08T00:00:00Z", "2000000.000000"),
    ];
    const bars = accrualToBars(samples);
    expect(bars).not.toBeNull();
    expect(bars).toHaveLength(YIELD_CHART_N);
  });

  it("returns bars with value in dollars (human units, not sub-units)", () => {
    const samples = [makeSample("2025-01-01T00:00:00Z", "2910000.000000")];
    const bars = accrualToBars(samples)!;
    // All bars should have the same value (single sample resampled)
    expect(bars[0]!.value).toBeCloseTo(2910000, 0);
  });
});

// ── pointsToBars ──────────────────────────────────────────────────────────────

describe("pointsToBars", () => {
  it("returns null for undefined input", () => {
    expect(pointsToBars(undefined)).toBeNull();
  });

  it("returns null for empty array", () => {
    expect(pointsToBars([])).toBeNull();
  });

  it("returns null when all values are zero", () => {
    const points = [{ timestamp: "2025-01-01T00:00:00Z", value: "0.000000" }];
    expect(pointsToBars(points)).toBeNull();
  });

  it("returns YIELD_CHART_N bars for a single valid point", () => {
    const points = [
      { timestamp: "2025-01-01T00:00:00Z", value: "1000000.000000" },
    ];
    const bars = pointsToBars(points);
    expect(bars).not.toBeNull();
    expect(bars).toHaveLength(YIELD_CHART_N);
  });

  it("all bars from a single point have height >= 2 (floor)", () => {
    const points = [
      { timestamp: "2025-01-01T00:00:00Z", value: "1000000.000000" },
    ];
    const bars = pointsToBars(points)!;
    for (const bar of bars) {
      expect(bar.height).toBeGreaterThanOrEqual(2);
    }
  });

  it("normalises heights: last bar is 100 when values are monotone increasing", () => {
    const points = [
      { timestamp: "2025-01-01T00:00:00Z", value: "1000000.000000" },
      { timestamp: "2025-01-08T00:00:00Z", value: "2000000.000000" },
      { timestamp: "2025-01-15T00:00:00Z", value: "3000000.000000" },
    ];
    const bars = pointsToBars(points)!;
    expect(bars[YIELD_CHART_N - 1]!.height).toBe(100);
  });

  it("normalises heights to 0–100 range", () => {
    const points = [
      { timestamp: "2025-01-01T00:00:00Z", value: "1000000.000000" },
      { timestamp: "2025-01-08T00:00:00Z", value: "2000000.000000" },
    ];
    const bars = pointsToBars(points)!;
    for (const bar of bars) {
      expect(bar.height).toBeGreaterThanOrEqual(2);
      expect(bar.height).toBeLessThanOrEqual(100);
    }
  });

  it("skips non-numeric values", () => {
    const points = [
      { timestamp: "2025-01-01T00:00:00Z", value: "bad" },
      { timestamp: "2025-01-08T00:00:00Z", value: "1000000.000000" },
    ];
    const bars = pointsToBars(points);
    expect(bars).not.toBeNull();
    expect(bars).toHaveLength(YIELD_CHART_N);
  });

  it("skips negative values", () => {
    const points = [
      { timestamp: "2025-01-01T00:00:00Z", value: "-1000.000000" },
      { timestamp: "2025-01-08T00:00:00Z", value: "2000000.000000" },
    ];
    const bars = pointsToBars(points)!;
    // Only the positive point is included; all bars should reflect that value
    expect(bars).not.toBeNull();
    expect(bars[0]!.value).toBeCloseTo(2000000, 0);
  });

  it("skips entries with invalid timestamps", () => {
    const points = [
      { timestamp: "not-a-date", value: "1000000.000000" },
      { timestamp: "2025-01-08T00:00:00Z", value: "2000000.000000" },
    ];
    const bars = pointsToBars(points);
    expect(bars).not.toBeNull();
    expect(bars).toHaveLength(YIELD_CHART_N);
  });

  it("value in bars is in human units (not sub-units)", () => {
    const points = [
      { timestamp: "2025-01-01T00:00:00Z", value: "2910000.000000" },
    ];
    const bars = pointsToBars(points)!;
    expect(bars[0]!.value).toBeCloseTo(2910000, 0);
  });

  it("works for TVL field name mapped to value", () => {
    const tvlPoints = [
      { timestamp: "2025-01-01T00:00:00Z", tvl: "10000000.000000" },
      { timestamp: "2025-01-08T00:00:00Z", tvl: "20000000.000000" },
    ];
    const mapped = tvlPoints.map((p) => ({
      timestamp: p.timestamp,
      value: p.tvl,
    }));
    const bars = pointsToBars(mapped)!;
    expect(bars).not.toBeNull();
    expect(bars[YIELD_CHART_N - 1]!.height).toBe(100);
  });

  it("works for cumulative_yield field name mapped to value", () => {
    const yieldPoints = [
      {
        timestamp: "2025-01-01T00:00:00Z",
        cumulative_yield: "1000000.000000",
      },
      {
        timestamp: "2025-01-08T00:00:00Z",
        cumulative_yield: "2910000.000000",
      },
    ];
    const mapped = yieldPoints.map((p) => ({
      timestamp: p.timestamp,
      value: p.cumulative_yield,
    }));
    const bars = pointsToBars(mapped)!;
    expect(bars).not.toBeNull();
    expect(bars).toHaveLength(YIELD_CHART_N);
  });
});

// ── latestAccrued ─────────────────────────────────────────────────────────────

describe("latestAccrued", () => {
  it("returns null for undefined input", () => {
    expect(latestAccrued(undefined)).toBeNull();
  });

  it("returns null for empty array", () => {
    expect(latestAccrued([])).toBeNull();
  });

  it("returns the accrued value for a single sample", () => {
    const samples = [makeSample("2025-01-01T00:00:00Z", "1000000.000000")];
    expect(latestAccrued(samples)).toBeCloseTo(1000000, 0);
  });

  it("returns the value of the last sample by timestamp", () => {
    const samples = [
      makeSample("2025-01-01T00:00:00Z", "1000000.000000"),
      makeSample("2025-01-15T00:00:00Z", "2910000.000000"),
      makeSample("2025-01-08T00:00:00Z", "2000000.000000"),
    ];
    // Latest by timestamp is 2025-01-15 → accrued = 2910000
    expect(latestAccrued(samples)).toBeCloseTo(2910000, 0);
  });

  it("returns null when all samples have invalid accrued", () => {
    const samples: SampleYieldItem[] = [
      {
        timestamp: "2025-01-01T00:00:00Z",
        apy: null,
        accrued: "not-a-number",
        principal_outstanding: "0",
      },
    ];
    expect(latestAccrued(samples)).toBeNull();
  });
});
