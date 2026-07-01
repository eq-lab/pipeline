/**
 * Tests for `src/utils/statsPeriod.ts`.
 *
 * Covers:
 *   - `periodToQuery` for each known period id.
 *   - Unknown period id falls back to weekly (full-history) behaviour.
 *   - STATS_PERIODS array contains the expected ids and labels.
 */
import { describe, it, expect } from "vitest";
import { periodToQuery, STATS_PERIODS } from "./statsPeriod";

describe("periodToQuery", () => {
  it("7d → 7 days, hourly", () => {
    const result = periodToQuery("7d");
    expect(result).toEqual({ days: 7, interval: "hourly" });
  });

  it("1m → 30 days, daily", () => {
    const result = periodToQuery("1m");
    expect(result).toEqual({ days: 30, interval: "daily" });
  });

  it("3m → 90 days, daily", () => {
    const result = periodToQuery("3m");
    expect(result).toEqual({ days: 90, interval: "daily" });
  });

  it("1y → 365 days, daily", () => {
    const result = periodToQuery("1y");
    expect(result).toEqual({ days: 365, interval: "daily" });
  });

  it("all → no days, weekly (avoids 1000-sample 400)", () => {
    const result = periodToQuery("all");
    expect(result.interval).toBe("weekly");
    expect(result.days).toBeUndefined();
  });

  it("unknown id falls back to weekly (no days)", () => {
    const result = periodToQuery("unknown");
    expect(result.interval).toBe("weekly");
    expect(result.days).toBeUndefined();
  });

  it("empty string falls back to weekly", () => {
    const result = periodToQuery("");
    expect(result.interval).toBe("weekly");
    expect(result.days).toBeUndefined();
  });
});

describe("STATS_PERIODS", () => {
  it("contains exactly the five standard period ids", () => {
    const ids = STATS_PERIODS.map((p) => p.id);
    expect(ids).toEqual(["7d", "1m", "3m", "1y", "all"]);
  });

  it("has uppercase labels for 7D/1M/3M/1Y/All", () => {
    const labels = STATS_PERIODS.map((p) => p.label);
    expect(labels).toEqual(["7D", "1M", "3M", "1Y", "All"]);
  });
});
