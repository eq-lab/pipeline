/**
 * Tests for `src/utils/yieldSeries.ts`.
 *
 * Covers:
 *   - `accrualToBars`: empty → null, single point, multi-point normalisation,
 *     height floor, invalid/non-numeric samples are skipped.
 *   - `latestAccrued`: empty → null, single point, latest by timestamp.
 */
import { describe, it, expect } from "vitest";
import { accrualToBars, latestAccrued, YIELD_CHART_N } from "./yieldSeries";
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
