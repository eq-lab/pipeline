/**
 * Tests for the Loan detail presenter builders (`-useLoanDetail.ts`, issue #845).
 *
 * Pure — no DOM, no query layer. Covers the hero view-model (title, status
 * band, meta with derived "N days left", corridor omitted), the Price &
 * collateral mapping (plain-USD — NOT #840-scaled — with `—`/`n/a` on missing
 * inputs; 7-day change threaded from the loan-book row), and status classification.
 */
import { describe, it, expect } from "vitest";
import type { LoanBookEntry } from "@/api/useLoanBook";
import type { CollateralValuationResponse } from "@/api/useLoanValuation";
import { formatMaturityDate } from "@/utils/formatDate";
import {
  buildHero,
  buildPriceCollateral,
  classifyStatus,
} from "./-useLoanDetail";

const NOW_MS = 1_700_000_000_000;
const NOW_S = NOW_MS / 1000;

function makeEntry(overrides: Partial<LoanBookEntry> = {}): LoanBookEntry {
  return {
    loan_id: "4488",
    originator: "Helios Metals",
    borrower: "b1",
    commodity: "Lithium",
    principal: "5000.000000",
    senior_outstanding: "4300.000000",
    maturity: NOW_S + 9 * 86_400, // ~9 days out
    ccr_reported_at: NOW_S - 3600,
    spot_price: "10450.00",
    spot_change_7d: "-0.0120",
    collateral: "5831100.000000",
    ltv: null,
    ccr_bps: 13_500_000,
    duration_days: 180,
    rate: "0.130000",
    protection: null,
    status: "Performing",
    ...overrides,
  };
}

function makeValuation(
  overrides: Partial<CollateralValuationResponse> = {},
): CollateralValuationResponse {
  return {
    chain_id: 99_000_001,
    loan_id: "4488",
    commodity: "Lithium",
    valuation_mode: "StandardGoods",
    inputs: {
      haircut_pct: "10",
      reference_price_asset: "Li2CO3",
      price_provider: "provider-x",
      reference_price: "10450.00",
      quantity_dmt: "620",
    },
    collateral_value: "5831100.00",
    ccr: {
      collateral_value: "5831100.00",
      outstanding_senior_principal: "4300000.00",
      ccr_bps: 13_500,
      ccr_pct: "135.00",
    },
    missing_inputs: [],
    ...overrides,
  };
}

// ── classifyStatus ──────────────────────────────────────────────────────────

describe("classifyStatus", () => {
  it("maps known statuses to a label + colour band", () => {
    expect(classifyStatus("Performing")).toEqual({
      label: "Performing",
      band: "positive",
    });
    expect(classifyStatus("WatchList")).toEqual({
      label: "Watchlist",
      band: "attention",
    });
    expect(classifyStatus("Default")).toEqual({
      label: "Default",
      band: "negative",
    });
    expect(classifyStatus("Matured")).toEqual({
      label: "Past Due",
      band: "negative",
    });
    expect(classifyStatus("Closed")).toEqual({
      label: "Closed",
      band: "neutral",
    });
  });

  it("falls back to the raw label + neutral band for an unknown status", () => {
    expect(classifyStatus("Weird")).toEqual({
      label: "Weird",
      band: "neutral",
    });
  });
});

// ── buildHero ─────────────────────────────────────────────────────────────────

describe("buildHero", () => {
  it("builds title, status, and a meta line with derived days-left (corridor omitted)", () => {
    const hero = buildHero(makeEntry(), NOW_MS);
    expect(hero.title).toBe("Helios Metals · Lithium");
    expect(hero.status).toEqual({ label: "Performing", band: "positive" });
    expect(hero.meta).toBe(
      `Loan #4488 · matures ${formatMaturityDate(NOW_S + 9 * 86_400)} · 9 days left`,
    );
    // Never fabricates a corridor.
    expect(hero.meta).not.toContain("→");
  });

  it("omits days-left once maturity is in the past", () => {
    const hero = buildHero(makeEntry({ maturity: NOW_S - 86_400 }), NOW_MS);
    expect(hero.meta).not.toContain("days left");
    expect(hero.meta).toContain("matures");
  });

  it("singularizes '1 day left'", () => {
    const hero = buildHero(makeEntry({ maturity: NOW_S + 3600 }), NOW_MS);
    expect(hero.meta).toContain("1 day left");
  });
});

// ── buildPriceCollateral ────────────────────────────────────────────────────

describe("buildPriceCollateral", () => {
  it("maps plain-USD values (NOT #840-scaled) + the 7-day change from the row", () => {
    const pc = buildPriceCollateral(makeValuation(), "-0.0120");
    expect(pc.spot).toEqual({
      text: "Li2CO3 $10,450 · −1.2% 7d",
      negative: true,
    });
    expect(pc.quantity).toBe("620 t");
    expect(pc.collateralLabel).toBe("Collateral value (after 10% haircut)");
    expect(pc.collateralValue).toBe("$5,831,100");
    expect(pc.seniorOutstanding).toBe("$4,300,000");
    expect(pc.ccr).toBe("135%");
  });

  it("renders — / n/a for every missing input, never fabricating", () => {
    const pc = buildPriceCollateral(
      makeValuation({
        inputs: {
          haircut_pct: "10",
          reference_price_asset: "Li2CO3",
          price_provider: "provider-x",
          reference_price: null,
          quantity_dmt: null,
        },
        collateral_value: null,
        ccr: null,
      }),
      null,
    );
    expect(pc.spot).toBeNull();
    expect(pc.quantity).toBe("—");
    expect(pc.collateralValue).toBe("—");
    expect(pc.seniorOutstanding).toBe("—");
    expect(pc.ccr).toBe("n/a");
  });

  it("shows the spot price alone when no 7-day change is available", () => {
    const pc = buildPriceCollateral(makeValuation(), null);
    expect(pc.spot).toEqual({ text: "Li2CO3 $10,450", negative: false });
  });
});
