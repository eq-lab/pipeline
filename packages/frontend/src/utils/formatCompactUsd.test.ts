/**
 * Unit tests for compact USD and related loan-book formatters.
 *
 * Critical invariant: base-6 decimal strings are read as human units.
 * `"8000000.000000"` must produce `"$8.0M"`, NOT `"$0.0"` (raw sub-unit
 * treatment would have divided by 1e6 first, yielding `"$8.0"` — still wrong).
 */
import { describe, it, expect } from "vitest";
import {
  formatCompactUsd,
  formatOneDecimalRate,
  formatLtv,
  formatCoverage,
  formatDurationDays,
} from "./formatCompactUsd";

// ── formatCompactUsd ─────────────────────────────────────────────────────────

describe("formatCompactUsd", () => {
  // Scale-bug guard: the primary test that human-unit strings are NOT divided
  // by 1e6 again.
  it("reads base-6 decimal strings as already human-scaled millions", () => {
    expect(formatCompactUsd("8000000.000000")).toBe("$8.0M");
  });

  it("handles a non-round million value", () => {
    expect(formatCompactUsd("31600000.000000")).toBe("$31.6M");
  });

  it("handles a value just above 1 M", () => {
    expect(formatCompactUsd("1000000.000000")).toBe("$1.0M");
  });

  it("handles thousands", () => {
    expect(formatCompactUsd("500000.000000")).toBe("$500.0K");
  });

  it("handles a non-round thousand value", () => {
    expect(formatCompactUsd("1200.000000")).toBe("$1.2K");
  });

  it("handles sub-thousand values with 2 decimal places", () => {
    expect(formatCompactUsd("999.000000")).toBe("$999.00");
    expect(formatCompactUsd("999")).toBe("$999.00");
  });

  it("preserves cents for sub-dollar values", () => {
    // Bug guard: "0.900000" must NOT round to "$1".
    expect(formatCompactUsd("0.900000")).toBe("$0.90");
  });

  it("formats a fractional sub-thousand value with 2 decimal places", () => {
    expect(formatCompactUsd("12.5")).toBe("$12.50");
  });

  it("handles zero", () => {
    expect(formatCompactUsd("0.000000")).toBe("$0");
    expect(formatCompactUsd("0")).toBe("$0");
  });

  it("returns em-dash for null", () => {
    expect(formatCompactUsd(null)).toBe("—");
  });

  it("returns em-dash for undefined", () => {
    expect(formatCompactUsd(undefined)).toBe("—");
  });

  it("returns em-dash for non-numeric input", () => {
    expect(formatCompactUsd("not-a-number")).toBe("—");
  });

  it("returns em-dash for empty string", () => {
    expect(formatCompactUsd("")).toBe("—");
  });
});

// ── formatOneDecimalRate ──────────────────────────────────────────────────────

describe("formatOneDecimalRate", () => {
  it("formats a typical rate with one decimal", () => {
    expect(formatOneDecimalRate("0.112000")).toBe("11.2%");
  });

  it("formats another rate at one decimal", () => {
    expect(formatOneDecimalRate("0.106000")).toBe("10.6%");
  });

  it("formats zero correctly", () => {
    expect(formatOneDecimalRate("0")).toBe("0.0%");
  });

  it("returns em-dash for null", () => {
    expect(formatOneDecimalRate(null)).toBe("—");
  });

  it("returns em-dash for undefined", () => {
    expect(formatOneDecimalRate(undefined)).toBe("—");
  });

  it("returns em-dash for non-numeric input", () => {
    expect(formatOneDecimalRate("n/a")).toBe("—");
  });
});

// ── formatLtv ────────────────────────────────────────────────────────────────

describe("formatLtv", () => {
  it("rounds a 4-decimal fraction to an integer percentage", () => {
    expect(formatLtv("0.8511")).toBe("85%");
  });

  it("handles 100%", () => {
    expect(formatLtv("1.0000")).toBe("100%");
  });

  it("rounds mid-values correctly", () => {
    expect(formatLtv("0.8350")).toBe("84%");
    expect(formatLtv("0.8351")).toBe("84%");
    expect(formatLtv("0.8350")).toBe("84%");
  });

  it("formats a large LTV with a thousands separator", () => {
    // "1333.3333" → Math.round(1333.3333 * 100) = 133333 → "133,333%"
    expect(formatLtv("1333.3333")).toBe("133,333%");
  });

  it("returns em-dash for null", () => {
    expect(formatLtv(null)).toBe("—");
  });

  it("returns em-dash for undefined", () => {
    expect(formatLtv(undefined)).toBe("—");
  });
});

// ── formatCoverage ────────────────────────────────────────────────────────────

describe("formatCoverage", () => {
  it("formats a 2-decimal ratio as one-decimal x-suffix", () => {
    expect(formatCoverage("1.50")).toBe("1.5x");
  });

  it("handles a round number", () => {
    expect(formatCoverage("2.00")).toBe("2.0x");
  });

  it("returns em-dash for null", () => {
    expect(formatCoverage(null)).toBe("—");
  });

  it("returns em-dash for undefined", () => {
    expect(formatCoverage(undefined)).toBe("—");
  });
});

// ── formatDurationDays ────────────────────────────────────────────────────────

describe("formatDurationDays", () => {
  it("compact variant adds 'd' suffix", () => {
    expect(formatDurationDays(120)).toBe("120d");
  });

  it("long variant adds ' days' suffix", () => {
    expect(formatDurationDays(68, "long")).toBe("68 days");
  });

  it("rounds fractional days", () => {
    expect(formatDurationDays(68.7)).toBe("69d");
    expect(formatDurationDays(68.3)).toBe("68d");
  });

  it("returns em-dash for null", () => {
    expect(formatDurationDays(null)).toBe("—");
    expect(formatDurationDays(null, "long")).toBe("—");
  });

  it("returns em-dash for undefined", () => {
    expect(formatDurationDays(undefined)).toBe("—");
  });
});
