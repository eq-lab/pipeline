/**
 * Tests for `-origination-detail.ts` — the Origination details page's
 * submission resolution + field mapping (issue #816).
 *
 * Covers:
 *   - A full `SubmissionView` + `CollateralValuationResponse` maps to the
 *     expected display strings (facility/tranches/rate/dates/corridor arrow/
 *     governing law/documents).
 *   - Missing/malformed `loan_data` fields render "—", never throw.
 *   - No router state → refetch fallback selects the submission by `id`;
 *     absent id → `not-found` state.
 *   - `waterfall: null` / 404 valuation → waterfall/CCR fields resolve to
 *     `—`/empty; INPUTS still render what's present.
 *   - `valuation_mode: "StandardGoods"` → the standard-goods row set.
 *   - `loan_data.initial_ccr` (1e6-scaled) surfaces as a distinct, always-
 *     present "Initial CCR (at submission)" figure — independent of whether
 *     `/valuations` has resolved.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useOriginationDetail } from "./-origination-detail";
import type { SubmissionView } from "@/api/useLoanSubmissions";
import type { CollateralValuationResponse } from "@/api/useCollateralValuation";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/api/useLoanSubmissions", async () => {
  const actual = await vi.importActual<
    typeof import("@/api/useLoanSubmissions")
  >("@/api/useLoanSubmissions");
  return {
    ...actual,
    useLoanSubmissions: vi.fn(),
  };
});

vi.mock("@/api/useCollateralValuation", async () => {
  const actual = await vi.importActual<
    typeof import("@/api/useCollateralValuation")
  >("@/api/useCollateralValuation");
  return {
    ...actual,
    useCollateralValuation: vi.fn(),
  };
});

import { useLoanSubmissions } from "@/api/useLoanSubmissions";
import { useCollateralValuation } from "@/api/useCollateralValuation";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FULL_SUBMISSION: SubmissionView = {
  id: 7,
  status: "InReview",
  reason: null,
  originator: "GAMF...", // authenticated submitter address (#813 field)
  created_at: "2026-06-18T10:00:00Z",
  updated_at: "2026-06-18T10:00:00Z",
  documents: [{ name: "Offtake agreement.pdf", uri: "ipfs://doc1" }],
  loan_data: {
    to: "G...",
    metadata_uri: "ipfs://...",
    originator: "Open Mineral", // human name — the heading/Deal-Details source
    borrower_id: "borrower-1",
    commodity: "Gold pyrite concentrate",
    corridor: "PE-CN",
    governing_law: "England & Wales",
    economics: {
      original_facility_size: "3500000.000000",
      original_senior_tranche: "2800000.000000",
      original_equity_tranche: "700000.000000",
      original_offtaker_price: "3750000.000000",
      senior_interest_rate_bps: 1400,
      origination_date: 1_783_929_600, // 2026-07-10T00:00:00Z-ish
      original_maturity_date: 1_765_756_800,
    },
    initial_ccr: 1_500_000,
    initial_location: {
      location_type: "Vessel",
      location_identifier: "MV Example",
      tracking_url: "https://example.com",
      updated_at: 1_750_000_000,
    },
  },
};

const FULL_VALUATION: CollateralValuationResponse = {
  chain_id: 99_000_001,
  loan_id: "7",
  commodity: "Gold pyrite concentrate",
  valuation_mode: "MetalConcentrate",
  inputs: {
    haircut_pct: "25",
    reference_price_asset: "XAU",
    price_provider: "chainlink",
    reference_price: "2410.00",
    quantity_dmt: "3400",
    moisture_pct: "8.2",
    metals: [
      {
        metal: "Au",
        grade_g_per_t: "32",
        payable_pct: "92",
        min_deduction_g_per_t: "1",
        reference_price: "2410",
        rc_per_oz: "6.5",
      },
    ],
    penalties: [],
    treatment_charge_per_dmt: "145",
    realisation_costs: "20000",
    quotational_period: "M+1",
    pricing_reference: null,
    incoterm: null,
    assay_status: "Final",
    assay_certificate_uri: null,
  },
  waterfall: {
    gross_value: "7491700.00",
    treatment_charge: "493000.00",
    refining_charge: "20000.00",
    penalties: "41000.00",
    nsr: "6937700.00",
    realisation_costs: "310000.00",
    mine_gate_value: "6627700.00",
    collateral_value: "4970800.00",
  },
  collateral_value: "4970800.00",
  ccr: {
    collateral_value: "4970800.00",
    outstanding_senior_principal: "2800000.00",
    ccr_bps: 17753,
    ccr_pct: "177.53",
  },
  missing_inputs: [],
};

function mockSubmissions(
  data: SubmissionView[] | undefined,
  isLoading = false,
) {
  vi.mocked(useLoanSubmissions).mockReturnValue({
    data,
    isLoading,
    error: null,
    refetch: vi.fn(),
  });
}

function mockValuation(
  data: CollateralValuationResponse | undefined,
  notFound: boolean,
  isLoading = false,
) {
  vi.mocked(useCollateralValuation).mockReturnValue({
    data,
    isLoading,
    notFound,
  });
}

// ── Happy path: full submission + full valuation ────────────────────────────

describe("useOriginationDetail — ready state with router-state submission", () => {
  it("maps loan terms, deal details, and heading from loan_data", () => {
    mockSubmissions([FULL_SUBMISSION]);
    mockValuation(FULL_VALUATION, false);

    const { result } = renderHook(() =>
      useOriginationDetail("7", FULL_SUBMISSION),
    );

    expect(result.current.state).toBe("ready");
    expect(result.current.heading).toBe(
      "Open Mineral — Gold pyrite concentrate",
    );
    expect(result.current.breadcrumb).toBe(
      "Open Mineral — Gold pyrite concentrate",
    );
    expect(result.current.loanTerms.facility).toBe("$3,500,000");
    expect(result.current.loanTerms.senior).toBe("$2,800,000");
    expect(result.current.loanTerms.equity).toBe("$700,000");
    expect(result.current.loanTerms.offtakerPrice).toBe("$3,750,000");
    expect(result.current.loanTerms.rate).toBe("14.0% p.a.");
    expect(result.current.dealDetails.originator).toBe("Open Mineral");
    expect(result.current.dealDetails.commodity).toBe(
      "Gold pyrite concentrate",
    );
    expect(result.current.dealDetails.corridor).toBe("PE → CN");
    expect(result.current.dealDetails.governingLaw).toBe("England & Wales");
    expect(result.current.dealDetails.documents).toEqual([
      { name: "Offtake agreement.pdf", uri: "ipfs://doc1" },
    ]);
  });

  it("maps the status chip label for InReview to 'Awaiting your review'", () => {
    mockSubmissions([FULL_SUBMISSION]);
    mockValuation(undefined, true);
    const { result } = renderHook(() =>
      useOriginationDetail("7", FULL_SUBMISSION),
    );
    expect(result.current.statusChip).toEqual({
      kind: "in-review",
      label: "Awaiting your review",
    });
  });

  it("maps a full valuation response to INPUTS + waterfall + CCR rows", () => {
    mockSubmissions([FULL_SUBMISSION]);
    mockValuation(FULL_VALUATION, false);
    const { result } = renderHook(() =>
      useOriginationDetail("7", FULL_SUBMISSION),
    );

    expect(result.current.valuation.hasData).toBe(true);
    expect(result.current.valuation.modeLabel).toBe("NSR");
    expect(result.current.valuation.inputRows.length).toBeGreaterThan(0);
    expect(result.current.valuation.waterfallRows.length).toBeGreaterThan(0);
    expect(result.current.valuation.ccrLabel).toBe("177.53%");
  });
});

// ── The 404 / no-valuation-yet default (the common case today) ──────────────

describe("useOriginationDetail — no valuation yet (404 default)", () => {
  it("resolves waterfall/CCR to empty/— without an error, INPUTS empty too when no data", () => {
    mockSubmissions([FULL_SUBMISSION]);
    mockValuation(undefined, true);

    const { result } = renderHook(() =>
      useOriginationDetail("7", FULL_SUBMISSION),
    );

    expect(result.current.valuation.hasData).toBe(false);
    expect(result.current.valuation.modeLabel).toBeNull();
    expect(result.current.valuation.inputRows).toEqual([]);
    expect(result.current.valuation.waterfallRows).toEqual([]);
    expect(result.current.valuation.ccrLabel).toBeNull();
  });

  it("still surfaces the initial CCR from loan_data.initial_ccr even when /valuations 404s", () => {
    mockSubmissions([FULL_SUBMISSION]);
    mockValuation(undefined, true);

    const { result } = renderHook(() =>
      useOriginationDetail("7", FULL_SUBMISSION),
    );

    // 1_500_000 (1e6-scaled) -> 150%
    expect(result.current.valuation.initialCcrLabel).toBe("150%");
  });

  it("renders '—' initial CCR when initial_ccr is missing/malformed, never throwing", () => {
    const submission: SubmissionView = {
      ...FULL_SUBMISSION,
      loan_data: {
        ...FULL_SUBMISSION.loan_data,
        // @ts-expect-error — intentionally malformed for the defensive-read test
        initial_ccr: "not-a-number",
      },
    };
    mockSubmissions([submission]);
    mockValuation(undefined, true);

    const { result } = renderHook(() => useOriginationDetail("7", submission));
    expect(result.current.valuation.initialCcrLabel).toBeNull();
  });

  it("also surfaces initial CCR when /valuations DOES have data (both figures present)", () => {
    mockSubmissions([FULL_SUBMISSION]);
    mockValuation(FULL_VALUATION, false);

    const { result } = renderHook(() =>
      useOriginationDetail("7", FULL_SUBMISSION),
    );

    expect(result.current.valuation.initialCcrLabel).toBe("150%");
    expect(result.current.valuation.ccrLabel).toBe("177.53%");
  });
});

// ── StandardGoods (waterfall: null but collateral_value/ccr present) ────────

describe("useOriginationDetail — StandardGoods valuation_mode", () => {
  it("renders the standard-goods mode label and no NSR waterfall rows", () => {
    const standardGoodsResponse: CollateralValuationResponse = {
      ...FULL_VALUATION,
      valuation_mode: "StandardGoods",
      waterfall: null,
      inputs: { ...FULL_VALUATION.inputs, metals: [], penalties: [] },
    };
    mockSubmissions([FULL_SUBMISSION]);
    mockValuation(standardGoodsResponse, false);

    const { result } = renderHook(() =>
      useOriginationDetail("7", FULL_SUBMISSION),
    );

    expect(result.current.valuation.hasData).toBe(true);
    expect(result.current.valuation.modeLabel).toBe("Standard");
    expect(result.current.valuation.waterfallRows).toEqual([]);
    // CCR is still available (computed off collateral_value directly).
    expect(result.current.valuation.ccrLabel).toBe("177.53%");
  });
});

// ── Missing/malformed loan_data fields — never throw, never fabricate ──────

describe("useOriginationDetail — defensive reads", () => {
  it("renders '—' for missing economics/loan_data fields", () => {
    const submission: SubmissionView = {
      ...FULL_SUBMISSION,
      loan_data: {
        ...FULL_SUBMISSION.loan_data,
        commodity: "",
        corridor: "",
        // @ts-expect-error — intentionally malformed for the defensive-read test
        economics: undefined,
      },
    };
    mockSubmissions([submission]);
    mockValuation(undefined, true);

    const { result } = renderHook(() => useOriginationDetail("7", submission));
    expect(result.current.dealDetails.commodity).toBe("—");
    expect(result.current.dealDetails.corridor).toBe("—");
    expect(result.current.loanTerms.facility).toBe("—");
    expect(result.current.loanTerms.rate).toBe("—");
  });

  it("renders an empty documents state gracefully when documents is []", () => {
    const submission: SubmissionView = { ...FULL_SUBMISSION, documents: [] };
    mockSubmissions([submission]);
    mockValuation(undefined, true);

    const { result } = renderHook(() => useOriginationDetail("7", submission));
    expect(result.current.dealDetails.documents).toEqual([]);
  });

  it("never throws for an entirely missing loan_data", () => {
    const submission: SubmissionView = {
      ...FULL_SUBMISSION,
      // @ts-expect-error — intentionally malformed for the defensive-read test
      loan_data: undefined,
    };
    mockSubmissions([submission]);
    mockValuation(undefined, true);

    expect(() =>
      renderHook(() => useOriginationDetail("7", submission)),
    ).not.toThrow();
  });
});

// ── Direct-URL / refresh fallback (no router state) ─────────────────────────

describe("useOriginationDetail — refetch fallback (no router state)", () => {
  it("selects the matching submission by id from the list when state is absent", () => {
    mockSubmissions([FULL_SUBMISSION]);
    mockValuation(undefined, true);

    const { result } = renderHook(() => useOriginationDetail("7", undefined));

    expect(result.current.state).toBe("ready");
    expect(result.current.dealDetails.originator).toBe("Open Mineral");
  });

  it("renders 'loading' while the fallback list query is loading", () => {
    mockSubmissions(undefined, true);
    mockValuation(undefined, false);

    const { result } = renderHook(() => useOriginationDetail("7", undefined));
    expect(result.current.state).toBe("loading");
  });

  it("renders 'not-found' when no submission matches the id", async () => {
    mockSubmissions([FULL_SUBMISSION], false);
    mockValuation(undefined, false);

    const { result } = renderHook(() => useOriginationDetail("999", undefined));

    await waitFor(() => {
      expect(result.current.state).toBe("not-found");
    });
  });
});
