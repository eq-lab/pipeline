/**
 * Unit tests for the Risk Council — Amend economics (off-cycle re-term)
 * presenter's pure helpers (`-risk-council-reterm.ts`, issue #782, flow 11).
 * All pure — no DOM, no query layer.
 */
import { describe, it, expect } from "vitest";
import {
  formatLoanLabel,
  formatCurrentCoupon,
  formatCcrPct,
} from "./-risk-council-reterm";

describe("formatLoanLabel", () => {
  it("joins originator and commodity with an em dash", () => {
    expect(formatLoanLabel("Delta Commodities", "Coffee")).toBe(
      "Delta Commodities — Coffee",
    );
  });

  it('renders "—" for missing parts (never fabricated)', () => {
    expect(formatLoanLabel(null, "Coffee")).toBe("— — Coffee");
    expect(formatLoanLabel("Delta", undefined)).toBe("Delta — —");
  });
});

describe("formatCurrentCoupon", () => {
  it("prefers the current epoch APY (bps → 1dp %)", () => {
    expect(formatCurrentCoupon(1200, "0.130000")).toBe("12.0%");
  });

  it("falls back to the loan-book rate decimal when no epoch APY is on record", () => {
    expect(formatCurrentCoupon(null, "0.130000")).toBe("13.0%");
    expect(formatCurrentCoupon(undefined, "0.145000")).toBe("14.5%");
  });

  it('returns "—" when neither is available (never fabricated)', () => {
    expect(formatCurrentCoupon(null, null)).toBe("—");
    expect(formatCurrentCoupon(NaN, "abc")).toBe("—");
  });
});

describe("formatCcrPct", () => {
  it("formats ccr_bps as a whole percent", () => {
    expect(formatCcrPct(11_400)).toBe("114%");
    expect(formatCcrPct(12_000)).toBe("120%");
  });

  it('returns "—" for missing / non-finite', () => {
    expect(formatCcrPct(null)).toBe("—");
    expect(formatCcrPct(undefined)).toBe("—");
    expect(formatCcrPct(NaN)).toBe("—");
  });
});
