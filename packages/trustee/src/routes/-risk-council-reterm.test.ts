// spec: docs/frontend/trustee-flows.md#risk-council-actions
import { describe, it, expect } from "vitest";
import { formatBpsRate } from "@/utils/formatUsd";
import {
  buildAdjustCall,
  buildAmendCall,
  formatCcrPct,
  parseSignedUsdDelta,
} from "./-risk-council-reterm";
import { formatLoanLabel } from "./-risk-council-shared";

const HASH = "ab".repeat(32);

describe("formatLoanLabel", () => {
  it("joins originator and commodity and dashes missing parts", () => {
    expect(formatLoanLabel("Delta Commodities", "Coffee")).toBe(
      "Delta Commodities — Coffee",
    );
    expect(formatLoanLabel(null, "Coffee")).toBe("— — Coffee");
    expect(formatLoanLabel("Delta", undefined)).toBe("Delta — —");
  });
});

describe("formatCcrPct", () => {
  it("formats whole percent and dashes missing values", () => {
    expect(formatCcrPct(11_400)).toBe("114%");
    expect(formatCcrPct(null)).toBe("—");
    expect(formatCcrPct(NaN)).toBe("—");
  });
});

describe("current rate decoding", () => {
  it("shows the contract rate (bps x 100) as a percent", () => {
    expect(formatBpsRate(145_000 / 100)).toBe("14.5%");
  });
});

describe("parseSignedUsdDelta", () => {
  it("converts to signed 7-decimal base units", () => {
    expect(parseSignedUsdDelta("-1,000.5")).toBe("-10005000000");
    expect(parseSignedUsdDelta("250")).toBe("2500000000");
    expect(parseSignedUsdDelta(" $12.25 ")).toBe("122500000");
  });

  it("rejects empty, zero and malformed input", () => {
    expect(parseSignedUsdDelta("")).toBeNull();
    expect(parseSignedUsdDelta("0")).toBeNull();
    expect(parseSignedUsdDelta("-0.00")).toBeNull();
    expect(parseSignedUsdDelta("abc")).toBeNull();
    expect(parseSignedUsdDelta("--5")).toBeNull();
  });
});

describe("buildAmendCall", () => {
  it("is null until the loan, rate and date are all valid", () => {
    expect(buildAmendCall(7, "", "2026-12-15")).toBeNull();
    expect(buildAmendCall(7, "14.5", "")).toBeNull();
    expect(buildAmendCall(null, "14.5", "2026-12-15")).toBeNull();
    expect(buildAmendCall(7, "0", "2026-12-15")).toBeNull();
  });

  it("builds the call in bps and UTC seconds", () => {
    expect(buildAmendCall(7, "14.5", "2026-12-15")).toEqual({
      fn: "amend_economics",
      loanId: 7,
      rateBps: 1450,
      maturity: 1_797_292_800,
    });
  });
});

describe("buildAdjustCall", () => {
  it("needs a valid delta and a reason hash", () => {
    expect(buildAdjustCall(7, "-5", null)).toBeNull();
    expect(buildAdjustCall(7, "", HASH)).toBeNull();
    expect(buildAdjustCall(7, "-5", HASH)).toEqual({
      fn: "adjust_interest",
      loanId: 7,
      delta: "-50000000",
      reasonHash: HASH,
    });
  });
});
