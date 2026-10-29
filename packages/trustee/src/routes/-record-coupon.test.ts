/**
 * Tests for the Record-coupon presenter's pure helpers (`-record-coupon.ts`,
 * issue #882). All pure — no DOM, no query layer. Covers the scale
 * conversions (USD ↔ 7-decimal base-unit strings, the registry ×1000 #840
 * correction), the coupon-period day computation, and the principal-block gate.
 */
import { describe, it, expect } from "vitest";
import type { Epoch } from "@/api/useLoanFinancials";
import {
  buildRepaymentInput,
  coversSeniorPrincipal,
  computeCouponPeriod,
  computeScheduledCoupon,
  DUE_SOON_DAYS,
  hasCouponDue,
  parseUsdInput,
  todayDateInput,
  dateInputToValueDate,
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

  it("accepts display-formatted input — strips $, commas, and spaces (#1048)", () => {
    expect(parseUsdInput("1,234,567.89")).toBe(1234567.89);
    expect(parseUsdInput("$45,000")).toBe(45000);
    expect(parseUsdInput("$ 1,234.56")).toBe(1234.56);
  });
});

describe("usdToBaseUnits", () => {
  it("converts entered USD to 7-decimal SAC base units", () => {
    expect(usdToBaseUnits("45000")).toBe("450000000000");
    expect(usdToBaseUnits("123.45678")).toBe("1234567800");
    expect(usdToBaseUnits("123.45678", 6)).toBe("123456780");
  });

  it("accepts display-formatted input (#1048)", () => {
    expect(usdToBaseUnits("45,000")).toBe("450000000000");
    expect(usdToBaseUnits("$1,234,567.89")).toBe("12345678900000");
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

describe("dateInputToValueDate", () => {
  it("is the UTC-midnight Unix seconds of the date", () => {
    expect(dateInputToValueDate("2026-10-27")).toBe(1793059200);
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

describe("coversSeniorPrincipal (#1623)", () => {
  it("is false when the waterfall is missing or returns no principal", () => {
    expect(coversSeniorPrincipal(undefined)).toBe(false);
    expect(coversSeniorPrincipal({ senior_principal_returned: "0" })).toBe(
      false,
    );
  });

  it("is true for any positive principal", () => {
    expect(coversSeniorPrincipal({ senior_principal_returned: "1" })).toBe(
      true,
    );
    expect(
      coversSeniorPrincipal({ senior_principal_returned: "18400000000000" }),
    ).toBe(true);
  });
});

describe("buildRepaymentInput (issue #882)", () => {
  const WATERFALL = {
    senior_principal_returned: "0",
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

  it("returns null when the waterfall returns any senior principal (#1623)", () => {
    expect(
      buildRepaymentInput("1500000000000", {
        ...WATERFALL,
        senior_principal_returned: "1",
      }),
    ).toBeNull();
  });

  it("returns null before an amount/preview is available", () => {
    expect(buildRepaymentInput("0", WATERFALL)).toBeNull();
    expect(buildRepaymentInput("1500000000000", undefined)).toBeNull();
  });
});
