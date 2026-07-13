/**
 * Tests for `src/utils/formatUsd.ts`.
 *
 * Mirrors the LP `formatCompactUsd.test.ts` cases for the compact formatter,
 * plus the whole-dollar formatter used for the Capital Allocation total, plus
 * the bps-rate formatter used by the Origination table (issue #813).
 */
import { describe, it, expect } from "vitest";
import {
  formatBpsRate,
  formatCompactUsd,
  formatFullUsd,
  formatRegistryCompactUsd,
  formatRegistryFullUsd,
  scaleRegistryAmount,
} from "./formatUsd";

describe("formatCompactUsd", () => {
  it("formats whole millions without a decimal (Figma: $96M)", () => {
    expect(formatCompactUsd("96000000.000000")).toBe("$96M");
  });

  it("formats millions with one decimal (Figma: $8.4M)", () => {
    expect(formatCompactUsd("8400000.000000")).toBe("$8.4M");
  });

  it("formats millions with two decimals (Figma: $4.95M)", () => {
    expect(formatCompactUsd("4950000.000000")).toBe("$4.95M");
  });

  it("formats another two-decimal million value (Figma: $4.64M)", () => {
    expect(formatCompactUsd("4640000.000000")).toBe("$4.64M");
  });

  it("formats sub-10M with one decimal (Figma: $1.2M)", () => {
    expect(formatCompactUsd("1200000.000000")).toBe("$1.2M");
  });

  it("formats thousands (K)", () => {
    expect(formatCompactUsd("500000.000000")).toBe("$500K");
    expect(formatCompactUsd("1200.000000")).toBe("$1.2K");
  });

  it("formats sub-thousand values without a suffix", () => {
    expect(formatCompactUsd("900.000000")).toBe("$900");
    expect(formatCompactUsd("12.5")).toBe("$12.5");
  });

  it("formats zero as $0", () => {
    expect(formatCompactUsd("0.000000")).toBe("$0");
  });

  it("returns em-dash for null/undefined", () => {
    expect(formatCompactUsd(null)).toBe("—");
    expect(formatCompactUsd(undefined)).toBe("—");
  });

  it("returns em-dash for non-numeric input", () => {
    expect(formatCompactUsd("not-a-number")).toBe("—");
  });

  it("handles negative values", () => {
    expect(formatCompactUsd("-8400000.000000")).toBe("-$8.4M");
  });
});

describe("formatFullUsd", () => {
  it("formats the Figma total with thousands separators", () => {
    expect(formatFullUsd("115190000.000000")).toBe("$115,190,000");
  });

  it("formats zero", () => {
    expect(formatFullUsd("0.000000")).toBe("$0");
  });

  it("rounds to whole dollars (no cents)", () => {
    expect(formatFullUsd("96000000.500000")).toBe("$96,000,001");
  });

  it("returns em-dash for null/undefined", () => {
    expect(formatFullUsd(null)).toBe("—");
    expect(formatFullUsd(undefined)).toBe("—");
  });

  it("returns em-dash for non-numeric input", () => {
    expect(formatFullUsd("not-a-number")).toBe("—");
  });
});

// ── #840 registry-scale workaround (issue #843) ──────────────────────────────

describe("scaleRegistryAmount (#840 ×1000 workaround)", () => {
  it("multiplies a registry base-6 amount by 1000 (1000× too small on the wire)", () => {
    // A $1.2M facility arrives as "1200.000000" — scale to "1200000.000000".
    expect(scaleRegistryAmount("1200.000000")).toBe("1200000.000000");
  });

  it("scales the Figma Deployed-senior value ($96M served as 96000)", () => {
    expect(scaleRegistryAmount("96000.000000")).toBe("96000000.000000");
  });

  it("preserves fractional cents through the ×1000", () => {
    expect(scaleRegistryAmount("1840.000000")).toBe("1840000.000000");
  });

  it("returns null for null/undefined (passthrough — caller decides how to render)", () => {
    expect(scaleRegistryAmount(null)).toBeNull();
    expect(scaleRegistryAmount(undefined)).toBeNull();
  });

  it("returns null for non-finite input", () => {
    expect(scaleRegistryAmount("not-a-number")).toBeNull();
  });
});

describe("formatRegistryCompactUsd (#840 ×1000 workaround)", () => {
  it("scales then compact-formats (Figma Deployed senior: $96M)", () => {
    expect(formatRegistryCompactUsd("96000.000000")).toBe("$96M");
  });

  it("scales then compact-formats the At-risk sub ($4.85M)", () => {
    expect(formatRegistryCompactUsd("4850.000000")).toBe("$4.85M");
  });

  it("returns em-dash for null/undefined", () => {
    expect(formatRegistryCompactUsd(null)).toBe("—");
    expect(formatRegistryCompactUsd(undefined)).toBe("—");
  });

  it("returns em-dash for non-numeric input", () => {
    expect(formatRegistryCompactUsd("not-a-number")).toBe("—");
  });
});

describe("formatRegistryFullUsd (#840 ×1000 workaround)", () => {
  it("scales then full-formats the Senior outst. column (Figma: $1,840,000)", () => {
    expect(formatRegistryFullUsd("1840.000000")).toBe("$1,840,000");
  });

  it("scales the second Figma row ($1,260,000)", () => {
    expect(formatRegistryFullUsd("1260.000000")).toBe("$1,260,000");
  });

  it("returns em-dash for null/undefined", () => {
    expect(formatRegistryFullUsd(null)).toBe("—");
    expect(formatRegistryFullUsd(undefined)).toBe("—");
  });

  it("returns em-dash for non-numeric input", () => {
    expect(formatRegistryFullUsd("not-a-number")).toBe("—");
  });
});

describe("formatBpsRate", () => {
  it("formats bps to a one-decimal percentage (Figma: 14.0%)", () => {
    expect(formatBpsRate(1400)).toBe("14.0%");
  });

  it("formats another bps value (Figma: 13.0%)", () => {
    expect(formatBpsRate(1300)).toBe("13.0%");
  });

  it("formats zero", () => {
    expect(formatBpsRate(0)).toBe("0.0%");
  });

  it("returns em-dash for null/undefined", () => {
    expect(formatBpsRate(null)).toBe("—");
    expect(formatBpsRate(undefined)).toBe("—");
  });

  it("returns em-dash for non-finite input", () => {
    expect(formatBpsRate(NaN)).toBe("—");
    expect(formatBpsRate(Infinity)).toBe("—");
  });
});
