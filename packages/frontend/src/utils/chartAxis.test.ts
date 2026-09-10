/**
 * Tests for `src/utils/chartAxis.ts`.
 *
 * Per the 2026-09-10 resolutions on issue #1234: no domain rounding — the top
 * tick is the raw served `max`, compact zero-decimal; the middle tick is the
 * raw served `average`, positioned proportionally (`average / max`).
 */
import { describe, it, expect } from "vitest";
import { computeAxisTicks, formatAxisTickUsd } from "./chartAxis";

describe("formatAxisTickUsd", () => {
  it("formats millions with zero decimals", () => {
    expect(formatAxisTickUsd(23_140_000)).toBe("$23M");
  });

  it("formats thousands with zero decimals", () => {
    expect(formatAxisTickUsd(43_193.947876)).toBe("$43K");
  });

  it("formats sub-thousand values plainly, rounded to a whole dollar", () => {
    expect(formatAxisTickUsd(942.8)).toBe("$943");
    expect(formatAxisTickUsd(500)).toBe("$500");
  });

  it("renders bare $0 for zero", () => {
    expect(formatAxisTickUsd(0)).toBe("$0");
  });

  it("renders — for non-finite input", () => {
    expect(formatAxisTickUsd(NaN)).toBe("—");
    expect(formatAxisTickUsd(Infinity)).toBe("—");
  });

  it("does not emit formatCompactUsd's one-decimal form", () => {
    expect(formatAxisTickUsd(30_000_000)).not.toContain(".0M");
    expect(formatAxisTickUsd(30_000_000)).toBe("$30M");
  });

  it("formats negatives with a leading sign", () => {
    expect(formatAxisTickUsd(-1_500_000)).toBe("-$2M");
  });
});

describe("computeAxisTicks", () => {
  it("returns raw served max/average — no ceiling or rounding to a domain", () => {
    const ticks = computeAxisTicks(23_140_000, 18_450_060.931931);
    expect(ticks).toEqual({
      maxLabel: "$23M",
      avgLabel: "$18M",
      avgFraction: 18_450_060.931931 / 23_140_000,
      bottomLabel: "$0",
    });
  });

  it("positions the average tick proportionally, not at the geometric middle", () => {
    const ticks = computeAxisTicks(100, 90)!;
    expect(ticks.avgFraction).toBeCloseTo(0.9, 5);
  });

  it("returns null when max is missing, non-finite, or non-positive", () => {
    expect(computeAxisTicks(null, 50)).toBeNull();
    expect(computeAxisTicks(undefined, 50)).toBeNull();
    expect(computeAxisTicks(NaN, 50)).toBeNull();
    expect(computeAxisTicks(0, 0)).toBeNull();
    expect(computeAxisTicks(-10, 5)).toBeNull();
  });

  it("renders '—' for the average tick when average is missing, keeping the max/bottom ticks", () => {
    const ticks = computeAxisTicks(1000, null)!;
    expect(ticks.maxLabel).toBe("$1K");
    expect(ticks.avgLabel).toBe("—");
    expect(ticks.bottomLabel).toBe("$0");
  });

  it("clamps an average above max to fraction 1, never off the plot", () => {
    // Window stats and sampled series can diverge (documented risk) — an
    // average above max must not push the tick off the plot.
    const ticks = computeAxisTicks(100, 150)!;
    expect(ticks.avgFraction).toBe(1);
    expect(ticks.avgLabel).toBe("$150");
  });

  it("treats a negative average as invalid — same fallback as missing", () => {
    const ticks = computeAxisTicks(100, -5)!;
    expect(ticks.avgLabel).toBe("—");
    expect(ticks.avgFraction).toBe(0.5);
  });

  it("bottom tick is always literal $0, never the served min", () => {
    expect(computeAxisTicks(100, 50)!.bottomLabel).toBe("$0");
  });
});
