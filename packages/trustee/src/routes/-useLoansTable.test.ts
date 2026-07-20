/**
 * Tests for the Loans presenter logic (`-useLoansTable.ts`, issue #843,
 * corrected by #888).
 *
 * All pure — no DOM, no query layer. Covers the CCR classification (served
 * `ccr_bps` used as-is, no ÷1000 correction — #888), the 120% pre-default
 * classification boundaries, CCR staleness age, the spot sub-line (real
 * 7-day basis, no fabricated `/t`), the row + summary mappings (registry
 * amounts AND collateral scaled ×1000, `—` for every null), and the
 * per-status counts + active-tab client-side filter (Default/Closed empty per
 * resolved Open Question 2).
 */
import { describe, it, expect } from "vitest";
import type { LoanBookEntry, LoanBookResponse } from "@/api/useLoanBook";
import { formatMaturityDate } from "@/utils/formatDate";
import {
  buildLoansView,
  classifyCcr,
  formatCcrAge,
  formatSpot,
  mapEntryToRow,
  mapSummary,
  MAINTENANCE_MARGIN_BPS,
  HEALTHY_MARGIN_BPS,
  CONCENTRATION_LIMIT_PCT,
} from "./-useLoansTable";

const NOW_MS = 1_700_000_000_000;
const NOW_S = NOW_MS / 1000;

function makeEntry(overrides: Partial<LoanBookEntry> = {}): LoanBookEntry {
  return {
    loan_id: "4488",
    chain_id: 99_000_001,
    originator: "Delta Commodities",
    borrower: "borrower-1",
    commodity: "Coffee",
    principal: "2000.000000",
    senior_outstanding: "1840.000000",
    maturity: 1_785_000_000,
    ccr_reported_at: NOW_S - 3600,
    spot_price: "4500.00",
    spot_change_7d: "-0.1800",
    collateral: "2100.000000",
    ltv: null,
    ccr_bps: 11_400, // served as-is (#888) ⇒ 114%, no ÷1000 correction
    duration_days: 180,
    rate: "0.140000",
    protection: null,
    status: "WatchList",
    ...overrides,
  };
}

// ── classifyCcr (120% maintenance-margin bands) ───────────────────────────────

describe("classifyCcr", () => {
  it("uses MAINTENANCE_MARGIN_BPS = 12000 (120%) and HEALTHY_MARGIN_BPS = 13000 (130%)", () => {
    expect(MAINTENANCE_MARGIN_BPS).toBe(12_000);
    expect(HEALTHY_MARGIN_BPS).toBe(13_000);
  });

  it("119.99% → pre-default", () => {
    expect(classifyCcr(11_999)).toBe("pre-default");
  });

  it("120% → attention (boundary is inclusive of the maintenance margin)", () => {
    expect(classifyCcr(12_000)).toBe("attention");
  });

  it("129.99% → attention", () => {
    expect(classifyCcr(12_999)).toBe("attention");
  });

  it("130% → healthy", () => {
    expect(classifyCcr(13_000)).toBe("healthy");
  });

  it("null → null (no flag)", () => {
    expect(classifyCcr(null)).toBeNull();
  });
});

// ── formatCcrAge ──────────────────────────────────────────────────────────────

describe("formatCcrAge", () => {
  it("formats an hour-old timestamp as '1h' (Figma)", () => {
    expect(formatCcrAge(NOW_S - 3600, NOW_MS)).toBe("1h");
  });

  it("formats 26 hours as '26h' (Figma, no day rollover under 72h)", () => {
    expect(formatCcrAge(NOW_S - 26 * 3600, NOW_MS)).toBe("26h");
  });

  it("formats sub-hour ages in minutes", () => {
    expect(formatCcrAge(NOW_S - 5 * 60, NOW_MS)).toBe("5m");
  });

  it("rolls over to days at/after 72h", () => {
    expect(formatCcrAge(NOW_S - 80 * 3600, NOW_MS)).toBe("3d");
  });

  it("returns em-dash for never-reported (0), missing, or future timestamps", () => {
    expect(formatCcrAge(0, NOW_MS)).toBe("—");
    expect(formatCcrAge(null, NOW_MS)).toBe("—");
    expect(formatCcrAge(NOW_S + 3600, NOW_MS)).toBe("—");
  });
});

// ── formatSpot ────────────────────────────────────────────────────────────────

describe("formatSpot", () => {
  it("renders the REAL 7-day basis, no fabricated /t unit (Figma-adjacent)", () => {
    expect(formatSpot("4500.00", "-0.1800")).toEqual({
      text: "$4,500 · −18% 7d",
      negative: true,
    });
  });

  it("uses a + sign and negative=false for a positive change", () => {
    expect(formatSpot("100.00", "0.0500")).toEqual({
      text: "$100 · +5% 7d",
      negative: false,
    });
  });

  it("shows the price alone when the 7-day change is null", () => {
    expect(formatSpot("6900.00", null)).toEqual({
      text: "$6,900",
      negative: false,
    });
  });

  it("returns null when the asset is unpriced", () => {
    expect(formatSpot(null, "-0.10")).toBeNull();
    expect(formatSpot("not-a-number", null)).toBeNull();
  });
});

// ── mapEntryToRow ─────────────────────────────────────────────────────────────

describe("mapEntryToRow", () => {
  it("scales registry senior AND collateral ×1000 (#888), maps the served CCR as-is", () => {
    const row = mapEntryToRow(makeEntry(), NOW_MS);
    // The served loan_id is both the stable list key and the /loans/$id nav param.
    expect(row.key).toBe("4488");
    expect(row.loanId).toBe("4488");
    expect(row.originator).toBe("Delta Commodities");
    expect(row.commodity).toBe("Coffee");
    // #840: senior_outstanding "1840" ⇒ $1.84M (×1000, two-decimal compact).
    expect(row.seniorOutstanding).toBe("$1.84M");
    // #888: collateral is ALSO registry-sourced ⇒ ×1000, two-decimal compact.
    expect(row.collateral).toBe("$2.10M");
    expect(row.spot).toEqual({ text: "$4,500 · −18% 7d", negative: true });
    expect(row.maturity).toBe(formatMaturityDate(1_785_000_000));
    expect(row.stage).toBe("WatchList");
    expect(row.status).toBe("WatchList");
    // ccr_bps 11_400 used as-is (no ÷1000) ⇒ 114%.
    expect(row.ccr).toEqual({
      percent: "114%",
      band: "pre-default",
      age: "1h",
    });
  });

  it("renders — / null for every missing field, never fabricating", () => {
    const row = mapEntryToRow(
      makeEntry({
        collateral: null,
        spot_price: null,
        spot_change_7d: null,
        ccr_bps: null,
        ccr_reported_at: 0,
      }),
      NOW_MS,
    );
    expect(row.collateral).toBe("—");
    expect(row.spot).toBeNull();
    expect(row.ccr).toBeNull();
  });

  it("matches issue #888's live payload for loan #1 (senior $1M, collateral $2,098,650, CCR 209.87%)", () => {
    const row = mapEntryToRow(
      makeEntry({
        loan_id: "1",
        principal: "1200.000000", // ×1000 ⇒ $1.2M (not rendered on this row, sanity only)
        senior_outstanding: "1000.000000", // ×1000 ⇒ $1M
        collateral: "2098.65", // ×1000 ⇒ $2,098,650 ⇒ $2.10M compact
        ccr_bps: 20_987, // served as-is (not ÷1000) ⇒ 209.87%
      }),
      NOW_MS,
    );
    expect(row.seniorOutstanding).toBe("$1.00M");
    expect(row.collateral).toBe("$2.10M");
    expect(row.ccr?.percent).toBe("210%"); // Math.round(20987 / 100)
  });
});

// ── mapSummary ────────────────────────────────────────────────────────────────

const SUMMARY: LoanBookResponse["summary"] = {
  total_deployed: "100000.000000",
  total_collateral: null,
  senior_debt_coverage: null,
  avg_yield: null,
  avg_duration_days: null,
  deployed_senior: "96000.000000",
  weighted_rate: "0.131000",
  weighted_tenor_days: 148,
  at_risk_wl_and_default_senior: "4850.000000",
  at_risk_wl_and_default_pct: "0.0430",
  top_concentration: { commodity: "Cocoa", share: "0.0720" },
};

describe("mapSummary", () => {
  it("maps the five cards to the Figma values (registry amounts scaled ×1000)", () => {
    const vm = mapSummary(SUMMARY);
    expect(vm.deployedSenior).toBe("$96M");
    expect(vm.atRiskPct).toBe("4.3%");
    expect(vm.atRiskSenior).toBe("$4.85M");
    expect(vm.weightedRate).toBe("13.1%");
    expect(vm.weightedTenor).toBe("148d");
    expect(vm.topConcentrationPct).toBe("7.2%");
    expect(vm.topConcentrationSub).toBe(
      `Cocoa · limit ${CONCENTRATION_LIMIT_PCT}%`,
    );
  });

  it("renders — for null summary fields (never fabricated)", () => {
    const vm = mapSummary({
      ...SUMMARY,
      weighted_rate: null,
      weighted_tenor_days: null,
      at_risk_wl_and_default_pct: null,
      top_concentration: null,
    });
    expect(vm.weightedRate).toBe("—");
    expect(vm.weightedTenor).toBe("—");
    expect(vm.atRiskPct).toBe("—");
    expect(vm.topConcentrationPct).toBe("—");
    expect(vm.topConcentrationSub).toBe("—");
  });
});

// ── buildLoansView — counts + client-side tab filter ──────────────────────────

describe("buildLoansView", () => {
  const data: LoanBookResponse = {
    summary: SUMMARY,
    loans: [
      makeEntry({ loan_id: "1", originator: "Alpha", status: "Performing" }),
      makeEntry({ loan_id: "2", originator: "Beta", status: "Performing" }),
      makeEntry({ loan_id: "3", originator: "Gamma", status: "WatchList" }),
    ],
  };

  it("counts each status; Default/Closed are 0 (backend serves active-only, OQ2)", () => {
    const { counts } = buildLoansView(data, "Performing", NOW_MS);
    expect(counts).toEqual({
      Performing: 2,
      Watchlist: 1,
      Default: 0,
      Closed: 0,
    });
  });

  it("filters rows to the active tab (Performing)", () => {
    const { rows } = buildLoansView(data, "Performing", NOW_MS);
    expect(rows.map((r) => r.originator)).toEqual(["Alpha", "Beta"]);
  });

  it("maps the Watchlist tab to the served 'WatchList' status literal", () => {
    const { rows } = buildLoansView(data, "Watchlist", NOW_MS);
    expect(rows.map((r) => r.originator)).toEqual(["Gamma"]);
  });

  it("yields an empty row set for the (unpopulated) Default tab", () => {
    const { rows } = buildLoansView(data, "Default", NOW_MS);
    expect(rows).toEqual([]);
  });

  it("includes Past Due / Matured loans under the Watchlist tab (#867)", () => {
    const withPastDue: LoanBookResponse = {
      summary: SUMMARY,
      loans: [
        makeEntry({ loan_id: "1", originator: "Alpha", status: "WatchList" }),
        makeEntry({ loan_id: "2", originator: "Bravo", status: "Past Due" }),
        makeEntry({ loan_id: "3", originator: "Charlie", status: "Matured" }),
        makeEntry({ loan_id: "4", originator: "Delta", status: "Performing" }),
      ],
    };
    const { counts, rows } = buildLoansView(withPastDue, "Watchlist", NOW_MS);
    expect(counts.Watchlist).toBe(3); // WatchList + Past Due + Matured
    expect(rows.map((r) => r.originator)).toEqual([
      "Alpha",
      "Bravo",
      "Charlie",
    ]);
  });

  it("includes Disbursing loans under the Performing tab (#864)", () => {
    const withDisbursing: LoanBookResponse = {
      summary: SUMMARY,
      loans: [
        ...data.loans,
        makeEntry({ loan_id: "4", originator: "Delta", status: "Disbursing" }),
      ],
    };
    const { counts, rows } = buildLoansView(
      withDisbursing,
      "Performing",
      NOW_MS,
    );
    expect(counts.Performing).toBe(3); // 2 Performing + 1 Disbursing
    expect(rows.map((r) => r.originator)).toEqual(["Alpha", "Beta", "Delta"]);
  });
});
