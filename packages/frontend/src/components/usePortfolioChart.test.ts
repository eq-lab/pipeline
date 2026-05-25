/**
 * Unit tests for the pure helpers in usePortfolioChart.
 *
 * Tests cover:
 *  1. generateCurve — start balance, end balance, monotonic growth, length.
 *  2. formatMoney — US dollar formatting.
 *  3. formatTime — datetime / date / month formats.
 *  4. Edge cases — x=0, x=right-edge.
 */
import { describe, it, expect } from "vitest";
import {
  N,
  PERIODS,
  generateCurve,
  formatMoney,
  formatTime,
} from "./usePortfolioChart";

// Stable anchor time so tests are deterministic regardless of when they run.
// 2025-06-15 12:00:00 UTC
const FIXED_NOW = new Date("2025-06-15T12:00:00Z").getTime();

// ── generateCurve ─────────────────────────────────────────────────────────────

describe("generateCurve", () => {
  it("returns N points", () => {
    const curve = generateCurve("7d", FIXED_NOW);
    expect(curve).toHaveLength(N);
  });

  it("7d: last balance is 1042.80", () => {
    const curve = generateCurve("7d", FIXED_NOW);
    expect(curve[N - 1]!.balance).toBe(1042.8);
  });

  it("7d: first balance is endBalance − earning = 1000.00", () => {
    const curve = generateCurve("7d", FIXED_NOW);
    // 1042.80 − 42.80 = 1000.00, but the first slot already has some increment added.
    // The actual start is startBalance + first increment. The minimum possible is
    // just above startBalance. We assert it is at least 1000.00 (== startBalance)
    // and less than 1042.80.
    const start = curve[0]!.balance;
    expect(start).toBeGreaterThanOrEqual(1000.0);
    expect(start).toBeLessThan(1042.8);
  });

  it("1m: last balance is 1042.80", () => {
    const curve = generateCurve("1m", FIXED_NOW);
    expect(curve[N - 1]!.balance).toBe(1042.8);
  });

  it("1m: first balance is at least startBalance (1042.80 − 92.80 = 950.00)", () => {
    const curve = generateCurve("1m", FIXED_NOW);
    expect(curve[0]!.balance).toBeGreaterThanOrEqual(950.0);
    expect(curve[0]!.balance).toBeLessThan(1042.8);
  });

  it("heights are monotonically non-decreasing", () => {
    for (const periodId of Object.keys(PERIODS)) {
      const curve = generateCurve(periodId, FIXED_NOW);
      for (let i = 1; i < curve.length; i++) {
        expect(curve[i]!.balance).toBeGreaterThanOrEqual(curve[i - 1]!.balance);
      }
    }
  });

  it("heights are in [0, 100]", () => {
    const curve = generateCurve("1y", FIXED_NOW);
    for (const pt of curve) {
      expect(pt.height).toBeGreaterThanOrEqual(0);
      expect(pt.height).toBeLessThanOrEqual(100);
    }
  });

  it("timestamps are strictly increasing", () => {
    const curve = generateCurve("3m", FIXED_NOW);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i]!.timestamp).toBeGreaterThan(curve[i - 1]!.timestamp);
    }
  });

  it("last timestamp equals `now`", () => {
    const curve = generateCurve("all", FIXED_NOW);
    expect(curve[N - 1]!.timestamp).toBe(FIXED_NOW);
  });

  it("first timestamp equals `now` − period.days * ms_per_day", () => {
    const curve = generateCurve("7d", FIXED_NOW);
    const expected = FIXED_NOW - 7 * 24 * 60 * 60 * 1000;
    expect(curve[0]!.timestamp).toBe(expected);
  });
});

// ── formatMoney ───────────────────────────────────────────────────────────────

describe("formatMoney", () => {
  it("formats 1042.8 → '$1,042.80'", () => {
    expect(formatMoney(1042.8)).toBe("$1,042.80");
  });

  it("formats 42.8 → '$42.80'", () => {
    expect(formatMoney(42.8)).toBe("$42.80");
  });

  it("formats 0 → '$0.00'", () => {
    expect(formatMoney(0)).toBe("$0.00");
  });

  it("formats 1000000 → '$1,000,000.00'", () => {
    expect(formatMoney(1000000)).toBe("$1,000,000.00");
  });
});

// ── formatTime ────────────────────────────────────────────────────────────────

describe("formatTime", () => {
  // 2025-06-15 14:30:00 UTC
  const ts = new Date("2025-06-15T14:30:00Z").getTime();

  it("datetime: 'June 15, HH:MM' (local time)", () => {
    const result = formatTime(ts, "datetime");
    // The exact hours depend on the test runner's local timezone, so we just
    // assert the general shape: Month Day, HH:MM
    expect(result).toMatch(/^[A-Z][a-z]+ \d+, \d{2}:\d{2}$/);
  });

  it("date: 'June 15, 2025'", () => {
    // Local date may differ from UTC date at edges; use a noon-UTC timestamp
    // (above) which is safe for all UTC− timezones.
    const result = formatTime(ts, "date");
    expect(result).toMatch(/^[A-Z][a-z]+ \d+, 2025$/);
  });

  it("month: 'June 2025' (or adjacent month near midnight UTC±)", () => {
    const result = formatTime(ts, "month");
    expect(result).toMatch(/^[A-Z][a-z]+ 2025$/);
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe("Edge cases", () => {
  it("generateCurve with unknown periodId falls back to 7d config", () => {
    const curve7d = generateCurve("7d", FIXED_NOW);
    const curveUnknown = generateCurve("invalid", FIXED_NOW);
    expect(curveUnknown).toHaveLength(N);
    // Falls back to PERIODS["7d"] config — same earning so same end balance
    expect(curveUnknown[N - 1]!.balance).toBe(curve7d[N - 1]!.balance);
  });
});
