/**
 * Tests for the Record-coupon presenter's pure helpers (`-record-coupon.ts`,
 * issue #882). All pure — no DOM, no query layer. Covers the scale
 * conversions (USD ↔ 7-decimal base-unit strings, the registry ×1000 #840
 * correction), the coupon-period day computation, and the terminal-close
 * ("Next stage: principal repayment") detection.
 */
import { describe, it, expect } from "vitest";
import type { Epoch } from "@/api/useLoanFinancials";
import {
  buildRepaymentInput,
  computeCouponPeriod,
  computeScheduledCoupon,
  DUE_SOON_DAYS,
  hasCouponDue,
  isTerminalRepayment,
  parseUsdInput,
  todayDateInput,
  usdToBaseUnits,
} from "./-record-coupon";

// `mapWaterfallError`'s tests moved to `src/utils/-userError.test.ts` (#1037,
// D5) — the presenter now re-exports the consolidated shared mapper rather
// than defining its own copy.

describe("parseUsdInput", () => {
  it("parses a positive numeric string", () => {
    expect(parseUsdInput("45000")).toBe(45000);
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
    expect(usdToBaseUnits("45000")).toBe("450000000000");
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

describe("computeCouponPeriod", () => {
  it('formats the period as "<start year> → <maturity year> · <days> days"', () => {
    const epoch: Epoch = {
      number: 1,
      current_apy_bps: 1000,
      start_date: "2026-01-02T00:00:00Z",
      maturity_date: "2026-03-31T00:00:00Z",
    };
    const result = computeCouponPeriod(epoch);
    expect(result.days).toBe(88);
    expect(result.label).toBe("2 Jan 2026 → 31 Mar 2026 · 88 days");
  });

  it('returns "—" / null days when no epoch is on record', () => {
    expect(computeCouponPeriod(null)).toEqual({ label: "—", days: null });
  });

  it('returns "—" / null days for unparseable dates (never fabricates)', () => {
    const epoch: Epoch = {
      number: 1,
      current_apy_bps: 1000,
      start_date: "not-a-date",
      maturity_date: "2026-03-31T00:00:00Z",
    };
    expect(computeCouponPeriod(epoch)).toEqual({ label: "—", days: null });
  });
});

describe("computeScheduledCoupon", () => {
  it("projects APY × outstanding senior × (days / 365)", () => {
    // 10.0% p.a. × $1,840,000 × 88/365 = 44,361.64…
    expect(computeScheduledCoupon(1000, 1_840_000, 88)).toBeCloseTo(
      44_361.64,
      2,
    );
    // 12.0% p.a. × $2,200,000 × 138/365 = 99,813.70… (the Figma mock's numbers).
    expect(computeScheduledCoupon(1200, 2_200_000, 138)).toBeCloseTo(
      99_813.7,
      1,
    );
  });

  it("returns null when the rate, outstanding senior, or period is unknown (never fabricates)", () => {
    expect(computeScheduledCoupon(null, 1_840_000, 88)).toBeNull();
    expect(computeScheduledCoupon(undefined, 1_840_000, 88)).toBeNull();
    expect(computeScheduledCoupon(NaN, 1_840_000, 88)).toBeNull();
    expect(computeScheduledCoupon(1000, null, 88)).toBeNull();
    expect(computeScheduledCoupon(1000, 1_840_000, null)).toBeNull();
  });
});

describe("hasCouponDue", () => {
  const MATURITY = "2026-03-31T00:00:00Z";
  const maturityMs = new Date(MATURITY).getTime();
  const day = 86_400_000;

  it("is true past due (on/after the epoch maturity)", () => {
    expect(hasCouponDue(MATURITY, maturityMs)).toBe(true); // exactly at maturity
    expect(hasCouponDue(MATURITY, maturityMs + 10 * day)).toBe(true);
  });

  it("is true when upcoming — within DUE_SOON_DAYS before maturity", () => {
    expect(hasCouponDue(MATURITY, maturityMs - 1 * day)).toBe(true);
    expect(hasCouponDue(MATURITY, maturityMs - DUE_SOON_DAYS * day)).toBe(true);
  });

  it("is false when the payment is still far off (more than DUE_SOON_DAYS away)", () => {
    expect(hasCouponDue(MATURITY, maturityMs - (DUE_SOON_DAYS + 1) * day)).toBe(
      false,
    );
    expect(hasCouponDue(MATURITY, maturityMs - 60 * day)).toBe(false);
  });

  it("honours a custom window", () => {
    expect(hasCouponDue(MATURITY, maturityMs - 20 * day, 30)).toBe(true);
    expect(hasCouponDue(MATURITY, maturityMs - 20 * day, 7)).toBe(false);
  });

  it("is false when the maturity is missing or unparseable (never fabricated)", () => {
    expect(hasCouponDue(null, maturityMs)).toBe(false);
    expect(hasCouponDue(undefined, maturityMs)).toBe(false);
    expect(hasCouponDue("not-a-date", maturityMs)).toBe(false);
  });
});

describe("isTerminalRepayment", () => {
  it("is true when the entered amount covers the outstanding senior AND the waterfall returns exactly that principal", () => {
    expect(isTerminalRepayment(1_840_000, 1_900_000, 1_840_000)).toBe(true);
  });

  it("is true at cent-level equality despite float drift from independent conversions", () => {
    // 1840000.005 rounds to the same cents as 1840000.00 at 2dp precision.
    expect(isTerminalRepayment(1_840_000, 1_840_000, 1_840_000.001)).toBe(true);
  });

  it("is false for a partial/interest-only coupon (principal returned is $0)", () => {
    expect(isTerminalRepayment(1_840_000, 45_000, 0)).toBe(false);
  });

  it("is false when the entered amount does not cover the outstanding senior, even if principal returned matches partially", () => {
    expect(isTerminalRepayment(1_840_000, 900_000, 900_000)).toBe(false);
  });

  it("is false when any input is unknown (never fabricates the terminal case)", () => {
    expect(isTerminalRepayment(null, 1_900_000, 1_840_000)).toBe(false);
    expect(isTerminalRepayment(1_840_000, null, 1_840_000)).toBe(false);
    expect(isTerminalRepayment(1_840_000, 1_900_000, null)).toBe(false);
  });

  it("is false when the loan has no outstanding senior on record", () => {
    expect(isTerminalRepayment(0, 1_900_000, 0)).toBe(false);
  });
});

describe("buildRepaymentInput (issue #882)", () => {
  // Backend raw 7-decimal SAC units. senior_principal_returned is
  // deliberately NON-zero to prove the interest-only override forces
  // senior_principal_repaid to "0" regardless.
  const WATERFALL = {
    senior_principal_returned: "9990000000", // ignored (interest-only)
    senior_coupon_net: "1155000000000", // $115,500
    management_fee: "120000000000", // $12,000
    performance_fee: "150000000000", // $15,000
    oet_allocation: "75000000000", // $7,500
  };

  it("forces zero principal (interest-only) + equity as the residual (sums to offtaker)", () => {
    // Offtaker $150,000; interest+fees sum to it → equity = 0.
    const input = buildRepaymentInput("1500000000000", WATERFALL);
    expect(input).toEqual({
      offtaker_received: "1500000000000",
      senior_principal_repaid: "0",
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

  it("routes the leftover to equity when interest+fees are below the offtaker amount", () => {
    // Offtaker $200,000; interest+fees $150,000 → equity = $50,000.
    const input = buildRepaymentInput("2000000000000", WATERFALL);
    expect(input!.equity_distributed).toBe("500000000000");
  });

  it("clamps equity at 0 (never negative) when interest+fees exceed the amount", () => {
    const input = buildRepaymentInput("1000000000000", WATERFALL);
    expect(input!.equity_distributed).toBe("0");
  });

  it("returns null before an amount/preview is available", () => {
    expect(buildRepaymentInput("0", WATERFALL)).toBeNull();
    expect(buildRepaymentInput("1500000000000", undefined)).toBeNull();
  });
});
