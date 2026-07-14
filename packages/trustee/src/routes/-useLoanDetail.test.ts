/**
 * Tests for the Loan-detail presenter (`-useLoanDetail.ts`, issues #845 / #847).
 *
 * All pure — no DOM, no query layer. Covers the status→band mapping, the hero
 * built from the loan-book row (with the loan-id-only degradation when no row is
 * found), and the Price & collateral view-model built from the valuation
 * response — including the never-fabricate `—` fallbacks and the real
 * `missing_inputs` "Awaiting:" note.
 */
import { describe, it, expect } from "vitest";
import type { LoanBookEntry } from "@/api/useLoanBook";
import type {
  LoanValuationResponse,
  UseLoanValuationResult,
} from "@/api/useLoanValuation";
import { ApiError } from "@/api/client";
import {
  buildHero,
  buildLifecycle,
  buildPriceCollateral,
  buildPriceCollateralState,
  statusToChip,
} from "./-useLoanDetail";

function makeEntry(overrides: Partial<LoanBookEntry> = {}): LoanBookEntry {
  return {
    loan_id: "4488",
    chain_id: 99_000_001,
    originator: "Helios Metals",
    borrower: "b1",
    commodity: "Lithium",
    principal: "4800000.000000",
    senior_outstanding: "4950.000000",
    maturity: 1_782_777_600, // 2026-06-30
    ccr_reported_at: 0,
    spot_price: "10450",
    spot_change_7d: "-0.012",
    collateral: null,
    ltv: null,
    ccr_bps: null,
    duration_days: 180,
    rate: "0.130000",
    protection: null,
    status: "Performing",
    ...overrides,
  };
}

function makeValuation(
  overrides: Partial<LoanValuationResponse> = {},
): LoanValuationResponse {
  return {
    chain_id: 99_000_001,
    loan_id: "4488",
    commodity: "Lithium Carbonate",
    valuation_mode: "MetalConcentrate",
    inputs: {
      haircut_pct: "0.10",
      reference_price_asset: "Li2CO3",
      price_provider: "coingecko",
      reference_price: "10450",
      quantity_dmt: "620",
      moisture_pct: null,
      metals: [],
      penalties: [],
      treatment_charge_per_dmt: null,
      realisation_costs: null,
      quotational_period: null,
      pricing_reference: null,
      incoterm: null,
      assay_status: null,
      assay_certificate_uri: null,
    },
    waterfall: null,
    collateral_value: "5831100.00",
    ccr: {
      collateral_value: "5831100.00",
      outstanding_senior_principal: "4950000.00",
      ccr_bps: 11_780,
      ccr_pct: "117.80",
    },
    missing_inputs: [],
    ...overrides,
  };
}

// ── statusToChip (design assignment §3.2) ─────────────────────────────────────

describe("statusToChip", () => {
  it("maps the raw on-chain status to the display chip + band", () => {
    expect(statusToChip("Performing")).toEqual({
      label: "Performing",
      band: "positive",
      raw: "Performing",
    });
    expect(statusToChip("WatchList")).toEqual({
      label: "Watchlist",
      band: "attention",
      raw: "WatchList",
    });
    expect(statusToChip("Default")).toEqual({
      label: "Default",
      band: "negative",
      raw: "Default",
    });
    expect(statusToChip("Closed")).toEqual({
      label: "Closed",
      band: "neutral",
      raw: "Closed",
    });
  });

  it("renames Matured → Past Due (display rename only, keeps raw)", () => {
    expect(statusToChip("Matured")).toEqual({
      label: "Past Due",
      band: "negative",
      raw: "Matured",
    });
  });

  it("falls through to a neutral chip printing an unknown status verbatim", () => {
    expect(statusToChip("Weird")).toEqual({
      label: "Weird",
      band: "neutral",
      raw: "Weird",
    });
  });
});

// ── buildHero ───────────────────────────────────────────────────────────────

describe("buildHero", () => {
  it("builds the identity + mapped chip; the status bar carries no dates", () => {
    const hero = buildHero("4488", makeEntry());
    expect(hero.title).toBe("Helios Metals · Lithium");
    expect(hero.status).toEqual({ label: "Performing", band: "positive" });
    // No maturity/days-left — just the id + the raw on-chain status.
    expect(hero.meta).toBe("Loan #4488 · on-chain Performing");
    expect(hero.backLabel).toBe("‹ Loans");
  });

  it("renames the chip for a Matured loan while printing the raw status", () => {
    const hero = buildHero("4488", makeEntry({ status: "Matured" }));
    expect(hero.status).toEqual({ label: "Past Due", band: "negative" });
    expect(hero.meta).toBe("Loan #4488 · on-chain Matured");
  });

  it("degrades to the loan id only when no row is found (never fabricates)", () => {
    const hero = buildHero("999", undefined);
    expect(hero.title).toBe("Loan #999");
    expect(hero.status).toBeNull();
    expect(hero.meta).toBe("Loan #999");
  });
});

// ── buildLifecycle (design assignment §3.2 status stepper) ────────────────────

describe("buildLifecycle", () => {
  const labels = (rawStatus: string | undefined) =>
    buildLifecycle(rawStatus).map((s) => `${s.label}:${s.state}`);

  it("opens with Origination then the §3.2 statuses, in order", () => {
    expect(buildLifecycle("Performing").map((s) => s.label)).toEqual([
      "Origination",
      "Disbursing",
      "Performing",
      "Watchlist",
      "Past Due",
      "Default",
      "Closed",
    ]);
  });

  it("marks a Performing loan: Origination + Disbursing done, Performing active", () => {
    expect(labels("Performing")).toEqual([
      "Origination:done",
      "Disbursing:done",
      "Performing:active",
      "Watchlist:pending",
      "Past Due:pending",
      "Default:pending",
      "Closed:pending",
    ]);
  });

  it("marks a WatchList loan active at Watchlist (earlier done, later pending)", () => {
    expect(labels("WatchList")).toEqual([
      "Origination:done",
      "Disbursing:done",
      "Performing:done",
      "Watchlist:active",
      "Past Due:pending",
      "Default:pending",
      "Closed:pending",
    ]);
  });

  it("maps on-chain Matured to the Past Due step being active", () => {
    const steps = buildLifecycle("Matured");
    expect(steps.find((s) => s.state === "active")?.label).toBe("Past Due");
  });

  it("marks a Closed loan: every earlier step done, Closed active", () => {
    expect(labels("Closed")).toEqual([
      "Origination:done",
      "Disbursing:done",
      "Performing:done",
      "Watchlist:done",
      "Past Due:done",
      "Default:done",
      "Closed:active",
    ]);
  });

  it("keeps Origination done even when the status is present but unmapped", () => {
    expect(labels("???")).toEqual([
      "Origination:done",
      "Disbursing:pending",
      "Performing:pending",
      "Watchlist:pending",
      "Past Due:pending",
      "Default:pending",
      "Closed:pending",
    ]);
  });

  it("leaves every step pending when there is no status at all (no loan-book row)", () => {
    expect(buildLifecycle(undefined).every((s) => s.state === "pending")).toBe(
      true,
    );
  });
});

// ── buildPriceCollateral ──────────────────────────────────────────────────────

describe("buildPriceCollateral", () => {
  it("maps a complete valuation to the five display rows", () => {
    const pc = buildPriceCollateral(makeValuation(), "-0.012");
    expect(pc.state).toBe("ready");
    expect(pc.providerNote).toBe("via coingecko");
    expect(pc.spot).toEqual({
      main: "$10,450",
      change: "−1.2% 7d",
      changeNegative: true,
    });
    expect(pc.rows).toEqual([
      { label: "Quantity", value: "620 dmt" },
      { label: "Collateral value (after 10% haircut)", value: "$5,831,100" },
      { label: "Senior outstanding", value: "$4,950,000" },
      { label: "CCR", value: "117.80%" },
    ]);
    expect(pc.missingNote).toBeNull();
  });

  it("drops the change span when no 7-day change is served", () => {
    const pc = buildPriceCollateral(makeValuation(), null);
    expect(pc.spot).toEqual({
      main: "$10,450",
      change: null,
      changeNegative: false,
    });
  });

  it("renders — for absent inputs and an 'Awaiting:' note from missing_inputs", () => {
    const pc = buildPriceCollateral(
      makeValuation({
        inputs: {
          ...makeValuation().inputs,
          reference_price: null,
          quantity_dmt: null,
        },
        collateral_value: null,
        ccr: null,
        missing_inputs: ["reference_price", "quantity"],
      }),
      null,
    );
    expect(pc.spot.main).toBe("—");
    expect(pc.rows).toEqual([
      { label: "Quantity", value: "—" },
      { label: "Collateral value (after 10% haircut)", value: "—" },
      { label: "Senior outstanding", value: "—" },
      { label: "CCR", value: "—" },
    ]);
    expect(pc.missingNote).toBe("Awaiting: reference_price, quantity");
  });
});

// ── buildPriceCollateralState (query states) ──────────────────────────────────

function makeQueryResult(
  overrides: Partial<UseLoanValuationResult> = {},
): UseLoanValuationResult {
  return {
    data: undefined,
    isLoading: false,
    error: null,
    refetch: () => {},
    ...overrides,
  };
}

describe("buildPriceCollateralState", () => {
  it("maps a loading query to the loading state", () => {
    expect(
      buildPriceCollateralState(makeQueryResult({ isLoading: true }), null)
        .state,
    ).toBe("loading");
  });

  it("maps a 404 to the neutral 'empty' state (no valuation anchor)", () => {
    const pc = buildPriceCollateralState(
      makeQueryResult({ error: new ApiError("not found", 404) }),
      null,
    );
    expect(pc.state).toBe("empty");
    expect(pc.missingNote).toBe("No valuation on record for this loan.");
  });

  it("maps a non-404 error to the error state", () => {
    const pc = buildPriceCollateralState(
      makeQueryResult({ error: new ApiError("boom", 500) }),
      null,
    );
    expect(pc.state).toBe("error");
    expect(pc.errorMessage).toBe("boom");
  });

  it("maps loaded data to the ready view-model", () => {
    const pc = buildPriceCollateralState(
      makeQueryResult({ data: makeValuation() }),
      "-0.012",
    );
    expect(pc.state).toBe("ready");
    expect(pc.spot.main).toBe("$10,450");
  });
});
