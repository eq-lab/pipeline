/**
 * Tests for the Record-repayment presenter's pure helpers (`-record-repayment.ts`,
 * issue #884). All pure — no DOM, no query layer. Covers the scale
 * conversions (USD ↔ 7-decimal base-unit strings, the registry ×1000 #840
 * correction), the final-period day computation, the terminal-repayment
 * detection, `buildRepaymentInput`'s REAL principal (unlike #882's forced
 * zero), and the `closureReason` gating.
 */
import { describe, it, expect } from "vitest";
import type { Epoch } from "@/api/useLoanFinancials";
import {
  buildRepaymentInput,
  closureReason,
  computeFinalPeriod,
  isTerminalRepayment,
  parseUsdInput,
  todayDateInput,
  usdToBaseUnits,
} from "./-record-repayment";

describe("parseUsdInput", () => {
  it("parses a positive numeric string", () => {
    expect(parseUsdInput("6150000")).toBe(6150000);
    expect(parseUsdInput("45000.5")).toBe(45000.5);
  });

  it("returns null for empty, zero, negative, or non-numeric input", () => {
    expect(parseUsdInput("")).toBeNull();
    expect(parseUsdInput("0")).toBeNull();
    expect(parseUsdInput("-100")).toBeNull();
    expect(parseUsdInput("abc")).toBeNull();
    expect(parseUsdInput("1.2.3")).toBeNull();
  });
});

describe("usdToBaseUnits", () => {
  it("converts entered USD to 7-decimal SAC base units", () => {
    expect(usdToBaseUnits("6150000")).toBe("61500000000000");
    expect(usdToBaseUnits("123.45678")).toBe("1234567800");
  });

  it("truncates beyond the SAC decimal precision", () => {
    expect(usdToBaseUnits("1.12345678")).toBe("11234567");
  });

  it('returns "0" for null (keeps the waterfall query disabled)', () => {
    expect(usdToBaseUnits(null)).toBe("0");
    expect(usdToBaseUnits("")).toBe("0");
    expect(usdToBaseUnits("-1")).toBe("0");
    expect(usdToBaseUnits("1.2.3")).toBe("0");
  });
});

describe("todayDateInput", () => {
  it("returns a YYYY-MM-DD string", () => {
    expect(todayDateInput()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("computeFinalPeriod", () => {
  it('formats the period as "<start year> → <maturity year> · <days> days"', () => {
    const epoch: Epoch = {
      number: 1,
      current_apy_bps: 1000,
      start_date: "2026-03-31T00:00:00Z",
      maturity_date: "2026-06-24T00:00:00Z",
    };
    const result = computeFinalPeriod(epoch);
    expect(result.days).toBe(85);
    expect(result.label).toBe("31 Mar 2026 → 24 Jun 2026 · 85 days");
  });

  it('returns "—" / null days when no epoch is on record', () => {
    expect(computeFinalPeriod(null)).toEqual({ label: "—", days: null });
  });

  it('returns "—" / null days for unparseable dates (never fabricates)', () => {
    const epoch: Epoch = {
      number: 1,
      current_apy_bps: 1000,
      start_date: "not-a-date",
      maturity_date: "2026-06-24T00:00:00Z",
    };
    expect(computeFinalPeriod(epoch)).toEqual({ label: "—", days: null });
  });
});

describe("isTerminalRepayment", () => {
  it("is true when the entered amount covers the outstanding senior AND the waterfall returns exactly that principal", () => {
    expect(isTerminalRepayment(4_800_000, 6_150_000, 4_800_000)).toBe(true);
  });

  it("is true at cent-level equality despite float drift from independent conversions", () => {
    expect(isTerminalRepayment(4_800_000, 4_800_000, 4_800_000.001)).toBe(true);
  });

  it("is false for a partial repayment (principal returned is less than outstanding)", () => {
    expect(isTerminalRepayment(4_800_000, 1_000_000, 1_000_000)).toBe(false);
  });

  it("is false when the entered amount does not cover the outstanding senior, even if principal returned matches partially", () => {
    expect(isTerminalRepayment(4_800_000, 900_000, 900_000)).toBe(false);
  });

  it("is false when any input is unknown (never fabricates the terminal case)", () => {
    expect(isTerminalRepayment(null, 6_150_000, 4_800_000)).toBe(false);
    expect(isTerminalRepayment(4_800_000, null, 4_800_000)).toBe(false);
    expect(isTerminalRepayment(4_800_000, 6_150_000, null)).toBe(false);
  });

  it("is false when the loan has no outstanding senior on record", () => {
    expect(isTerminalRepayment(0, 6_150_000, 0)).toBe(false);
  });
});

describe("closureReason (issue #884)", () => {
  it("returns ScheduledMaturity when now is at/after maturity", () => {
    expect(closureReason(1_782_777_600, 1_782_777_600)).toBe(
      "ScheduledMaturity",
    );
    expect(closureReason(1_782_777_601, 1_782_777_600)).toBe(
      "ScheduledMaturity",
    );
  });

  it("returns EarlyRepayment when now is before maturity", () => {
    expect(closureReason(1_782_777_599, 1_782_777_600)).toBe("EarlyRepayment");
  });
});

describe("buildRepaymentInput (issue #884 — REAL principal, unlike #882)", () => {
  // Backend raw 7-decimal SAC units. senior_principal_returned is the
  // REAL waterfall figure here (unlike #882's interest-only override to "0").
  const WATERFALL = {
    senior_principal_returned: "48000000000000", // $4,800,000
    senior_coupon_net: "1155000000000", // $115,500
    management_fee: "120000000000", // $12,000
    performance_fee: "150000000000", // $15,000
    oet_allocation: "75000000000", // $7,500
  };

  it("carries the real senior_principal_returned into senior_principal_repaid + equity as the residual (sums to offtaker)", () => {
    // Offtaker $4,950,000; principal+interest+fees sum to it → equity = 0.
    const input = buildRepaymentInput("49500000000000", WATERFALL);
    expect(input).toEqual({
      offtaker_received: "49500000000000",
      senior_principal_repaid: "48000000000000",
      senior_interest: "1155000000000",
      equity_distributed: "0",
      mgmt_fee: "120000000000",
      perf_fee: "150000000000",
      oet_alloc: "75000000000",
    });
    // The six components sum exactly to offtaker_received.
    const six =
      BigInt(input!.senior_principal_repaid) +
      BigInt(input!.senior_interest) +
      BigInt(input!.mgmt_fee) +
      BigInt(input!.perf_fee) +
      BigInt(input!.oet_alloc) +
      BigInt(input!.equity_distributed);
    expect(six).toBe(BigInt(input!.offtaker_received));
  });

  it("routes the leftover to equity (originator residual) when the offtaker amount exceeds principal+interest+fees", () => {
    // Offtaker $6,150,000; principal+interest+fees $4,950,000 → equity = $1,200,000.
    const input = buildRepaymentInput("61500000000000", WATERFALL);
    expect(input!.equity_distributed).toBe("12000000000000");
  });

  it("clamps equity at 0 (never negative) when principal+interest+fees exceed the amount", () => {
    const input = buildRepaymentInput("40000000000000", WATERFALL);
    expect(input!.equity_distributed).toBe("0");
  });

  it("returns null before an amount/preview is available", () => {
    expect(buildRepaymentInput("0", WATERFALL)).toBeNull();
    expect(buildRepaymentInput("61500000000000", undefined)).toBeNull();
  });
});
