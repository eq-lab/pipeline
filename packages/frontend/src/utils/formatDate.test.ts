/**
 * Unit tests for the LP frontend's In-Origination date formatters
 * (issue #814), mirroring `packages/trustee/src/utils/formatDate.test.ts`.
 */
import { describe, it, expect } from "vitest";
import {
  formatMaturityDate,
  formatSubmittedDate,
  sampleAxisDates,
} from "./formatDate";

// ── formatMaturityDate ──────────────────────────────────────────────────────

describe("formatMaturityDate", () => {
  it("formats a Unix-seconds timestamp as day + short month + full year", () => {
    // 2026-12-15T00:00:00Z
    expect(formatMaturityDate(1_797_292_800)).toBe("15 Dec 2026");
  });

  it("returns em-dash for null", () => {
    expect(formatMaturityDate(null)).toBe("—");
  });

  it("returns em-dash for undefined", () => {
    expect(formatMaturityDate(undefined)).toBe("—");
  });

  it("returns em-dash for non-finite input", () => {
    expect(formatMaturityDate(NaN)).toBe("—");
  });
});

// ── formatSubmittedDate ─────────────────────────────────────────────────────

describe("formatSubmittedDate", () => {
  it("formats an RFC 3339 timestamp as day + short month (no year)", () => {
    expect(formatSubmittedDate("2026-06-18T10:00:00Z")).toBe("18 Jun");
  });

  it("returns em-dash for null", () => {
    expect(formatSubmittedDate(null)).toBe("—");
  });

  it("returns em-dash for undefined", () => {
    expect(formatSubmittedDate(undefined)).toBe("—");
  });

  it("returns em-dash for an unparseable string", () => {
    expect(formatSubmittedDate("not-a-date")).toBe("—");
  });
});

// ── sampleAxisDates (#1234) ─────────────────────────────────────────────────

describe("sampleAxisDates", () => {
  it("samples 5 evenly-spaced labels from real served timestamps, never synthesised", () => {
    const timestamps = [
      Date.UTC(2026, 6, 20, 12),
      Date.UTC(2026, 6, 27, 12),
      Date.UTC(2026, 7, 3, 12),
      Date.UTC(2026, 7, 10, 12),
      Date.UTC(2026, 7, 17, 12),
      Date.UTC(2026, 7, 20, 12),
    ];
    expect(sampleAxisDates(timestamps)).toEqual([
      "Jul 20",
      "Jul 27",
      "Aug 10",
      "Aug 17",
      "Aug 20",
    ]);
  });

  it("repeats the same label for a single-point series, without crashing", () => {
    expect(sampleAxisDates([Date.UTC(2026, 6, 20, 12)])).toEqual([
      "Jul 20",
      "Jul 20",
      "Jul 20",
      "Jul 20",
      "Jul 20",
    ]);
  });

  it("returns an empty array for an empty series", () => {
    expect(sampleAxisDates([])).toEqual([]);
  });

  it("appends the two-digit year suffix to every label when sampled points cross a year boundary", () => {
    const timestamps = [
      Date.UTC(2025, 7, 20, 12),
      Date.UTC(2025, 10, 20, 12),
      Date.UTC(2026, 1, 20, 12),
      Date.UTC(2026, 4, 20, 12),
      Date.UTC(2026, 7, 20, 12),
    ];
    expect(sampleAxisDates(timestamps)).toEqual([
      "Aug 20 '25",
      "Nov 20 '25",
      "Feb 20 '26",
      "May 20 '26",
      "Aug 20 '26",
    ]);
  });

  it("supports an explicit count other than 5", () => {
    const timestamps = [
      Date.UTC(2026, 6, 1, 12),
      Date.UTC(2026, 6, 15, 12),
      Date.UTC(2026, 6, 30, 12),
    ];
    expect(sampleAxisDates(timestamps, 3)).toEqual([
      "Jul 1",
      "Jul 15",
      "Jul 30",
    ]);
  });
});
