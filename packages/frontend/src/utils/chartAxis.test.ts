/**
 * Tests for `src/utils/chartAxis.ts`.
 *
 * Per the 2026-09-10 change on issue #1234: no domain rounding — the top tick
 * is the raw served `max`, compact zero-decimal; the middle tick is a fixed
 * `max/2`; the served `average` is not consumed.
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
  it("returns raw served max with a fixed max/2 middle tick", () => {
    expect(computeAxisTicks(23_140_000)).toEqual({
      maxLabel: "$23M",
      midLabel: "$12M",
      bottomLabel: "$0",
    });
  });

  it("halves sub-thousand maxima to whole dollars", () => {
    expect(computeAxisTicks(1000)).toEqual({
      maxLabel: "$1K",
      midLabel: "$500",
      bottomLabel: "$0",
    });
  });

  it("returns null when max is missing, non-finite, or non-positive", () => {
    expect(computeAxisTicks(null)).toBeNull();
    expect(computeAxisTicks(undefined)).toBeNull();
    expect(computeAxisTicks(NaN)).toBeNull();
    expect(computeAxisTicks(0)).toBeNull();
    expect(computeAxisTicks(-10)).toBeNull();
  });

  it("bottom tick is always literal $0, never the served min", () => {
    expect(computeAxisTicks(100)!.bottomLabel).toBe("$0");
  });
});
