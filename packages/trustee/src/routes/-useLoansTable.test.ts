// spec: docs/frontend/trustee-flows.md#loan-book--tables
import { describe, it, expect } from "vitest";
import type { LoanBookEntry, LoanBookResponse } from "@/api/useLoanBook";
import { formatMaturityDate } from "@/utils/formatDate";
import {
  buildLoansView,
  formatNearestPayment,
  mapEntryToRow,
  mapLtvCell,
  mapSummary,
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
    original_senior_tranche: "1840.000000",
    maturity: 1_785_000_000,
    next_payment_timestamp: 1_785_000_000,
    days_overdue: null,
    duration_days: 180,
    rate: "0.140000",
    protection: null,
    status: "WatchList",
    onchain_status: "WatchList",
    documents: [],
    repaid_to_date: "0.000000",
    disbursed: true,
    days_on_watchlist: 18,
    watchlist_entered_at: NOW_S - 18 * 86_400,
    ...overrides,
  };
}

describe("formatNearestPayment", () => {
  it("shows the payment date when not overdue (days_overdue null)", () => {
    expect(formatNearestPayment(1_785_000_000, null)).toEqual({
      text: formatMaturityDate(1_785_000_000),
      overdue: false,
    });
  });

  it('shows "N days late" (plural/singular) when overdue', () => {
    expect(formatNearestPayment(1_785_000_000, 5)).toEqual({
      text: "5 days late",
      overdue: true,
    });
    expect(formatNearestPayment(1_785_000_000, 1)).toEqual({
      text: "1 day late",
      overdue: true,
    });
  });

  it('shows "Due today" for the first day overdue (days_overdue 0)', () => {
    expect(formatNearestPayment(1_785_000_000, 0)).toEqual({
      text: "Due today",
      overdue: true,
    });
  });

  it('returns "—" when the next-payment timestamp is missing/zero (never fabricated)', () => {
    expect(formatNearestPayment(0, null)).toEqual({
      text: "—",
      overdue: false,
    });
    expect(formatNearestPayment(null, null)).toEqual({
      text: "—",
      overdue: false,
    });
  });
});

// ── formatSpot ────────────────────────────────────────────────────────────────

// ── mapEntryToRow ─────────────────────────────────────────────────────────────

describe("mapEntryToRow", () => {
  it("maps the served amounts and identity, with no spot, collateral or CCR fields", () => {
    const row = mapEntryToRow(makeEntry());
    expect(row.key).toBe("99000001:4488");
    expect(row.loanId).toBe("4488");
    expect(row.chainId).toBe(99_000_001);
    expect(row.chain).toBe("Stellar");
    expect(row.originator).toBe("Delta Commodities");
    expect(row.commodity).toBe("Coffee");
    expect(row.seniorOutstanding).toBe("$1.84K");
    expect(row.nearestPayment).toEqual({
      text: formatMaturityDate(1_785_000_000),
      overdue: false,
    });
    expect(row.stage).toBe("WatchList");
    expect(row.status).toBe("WatchList");
    expect(row).not.toHaveProperty("spot");
    expect(row).not.toHaveProperty("collateral");
    expect(row).not.toHaveProperty("ccr");
  });
});

describe("mapLtvCell", () => {
  it("is blank for an EVM row even when the keys are present", () => {
    expect(
      mapLtvCell(
        makeEntry({ chain_id: 560048, ltv_bps: 8000, margin_call_open: true }),
      ),
    ).toBeNull();
  });

  it("renders — for a Stellar row with absent or null keys", () => {
    const expected = { text: "—", marginCallOpen: false, priceStale: false };
    expect(mapLtvCell(makeEntry())).toEqual(expected);
    expect(
      mapLtvCell(
        makeEntry({ ltv_bps: null, margin_call_open: null, price_stale: null }),
      ),
    ).toEqual(expected);
  });

  it("formats the served bps and carries the flags", () => {
    expect(
      mapLtvCell(
        makeEntry({ ltv_bps: 8123, margin_call_open: true, price_stale: true }),
      ),
    ).toEqual({ text: "81.2%", marginCallOpen: true, priceStale: true });
  });

  it("passes the u32::MAX sentinel through as 'No security value'", () => {
    expect(mapLtvCell(makeEntry({ ltv_bps: 4_294_967_295 }))?.text).toBe(
      "No security value",
    );
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
  it("maps the five cards to the Figma values (registry amounts displayed as served)", () => {
    const vm = mapSummary(SUMMARY);
    expect(vm.deployedSenior).toBe("$96K");
    expect(vm.atRiskPct).toBe("4.3%");
    expect(vm.atRiskSenior).toBe("$4.85K");
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
    const { counts } = buildLoansView(data, "Active");
    expect(counts).toEqual({
      All: 3,
      Active: 2,
      Watchlist: 1,
      Default: 0,
      Closed: 0,
    });
  });

  it("the All tab is unfiltered — every loan, in book order (#1121)", () => {
    const { rows } = buildLoansView(data, "All");
    expect(rows.map((r) => r.originator)).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("filters rows to the Active tab", () => {
    const { rows } = buildLoansView(data, "Active");
    expect(rows.map((r) => r.originator)).toEqual(["Alpha", "Beta"]);
  });

  it("maps the Watchlist tab to the served 'WatchList' status literal", () => {
    const { rows } = buildLoansView(data, "Watchlist");
    expect(rows.map((r) => r.originator)).toEqual(["Gamma"]);
  });

  it("yields an empty row set for the (unpopulated) Default tab", () => {
    const { rows } = buildLoansView(data, "Default");
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
    const { counts, rows } = buildLoansView(withPastDue, "Watchlist");
    expect(counts.Watchlist).toBe(3); // WatchList + Past Due + Matured
    expect(rows.map((r) => r.originator)).toEqual([
      "Alpha",
      "Bravo",
      "Charlie",
    ]);
  });

  it("includes Disbursing loans under the Active tab (#864)", () => {
    const withDisbursing: LoanBookResponse = {
      summary: SUMMARY,
      loans: [
        ...data.loans,
        makeEntry({ loan_id: "4", originator: "Delta", status: "Disbursing" }),
      ],
    };
    const { counts, rows } = buildLoansView(withDisbursing, "Active");
    expect(counts.Active).toBe(3); // 2 Performing + 1 Disbursing
    expect(rows.map((r) => r.originator)).toEqual(["Alpha", "Beta", "Delta"]);
  });
});

describe("buildLoansView showLtvColumn", () => {
  const view = (loans: LoanBookEntry[]) =>
    buildLoansView({ summary: SUMMARY, loans }, "All").showLtvColumn;

  it("is false when no row carries the keys (pre-backend) or all are null", () => {
    expect(view([makeEntry()])).toBe(false);
    expect(
      view([
        makeEntry({ ltv_bps: null, margin_call_open: null, price_stale: null }),
      ]),
    ).toBe(false);
  });

  it("is true for a Stellar row with an LTV or an open margin call", () => {
    expect(view([makeEntry({ ltv_bps: 7000 })])).toBe(true);
    expect(view([makeEntry({ margin_call_open: true })])).toBe(true);
  });

  it("ignores EVM rows", () => {
    expect(view([makeEntry({ chain_id: 560048, ltv_bps: 7000 })])).toBe(false);
  });
});
