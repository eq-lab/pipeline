// spec: docs/frontend/trustee-flows.md#loan-detail
import { describe, it, expect } from "vitest";
import type { LoanBookEntry } from "@/api/useLoanBook";
import type {
  LoanFinancialsResponse,
  UseLoanFinancialsResult,
} from "@/api/useLoanFinancials";
import { ApiError } from "@/api/client";
import {
  buildDocuments,
  buildFinancials,
  buildHero,
  buildLifecycle,
  buildRegistryState,
  buildSummaryTiles,
  selectOtherActions,
  statusToChip,
  allowedLifecycleTargets,
} from "./-useLoanDetail";
import {
  CLOSED_OTHER_ACTIONS,
  DISBURSING_OTHER_ACTIONS,
  MATURED_OTHER_ACTIONS,
  PERFORMING_OTHER_ACTIONS,
  WATCHLIST_OTHER_ACTIONS,
} from "./-loanDetailStatic";

function makeEntry(overrides: Partial<LoanBookEntry> = {}): LoanBookEntry {
  return {
    loan_id: "4488",
    chain_id: 99_000_001,
    originator: "Helios Metals",
    borrower: "b1",
    commodity: "Lithium",
    principal: "4800.000000",
    senior_outstanding: "3960.000000",
    original_senior_tranche: "3960.000000",
    maturity: 1_782_777_600, // 2026-06-30
    next_payment_timestamp: 1_782_777_600,
    days_overdue: null,
    duration_days: 180,
    rate: "0.130000",
    protection: null,
    status: "Performing",
    onchain_status: "Performing",
    documents: [],
    repaid_to_date: "6300.000000",
    disbursed: true,
    days_on_watchlist: null,
    watchlist_entered_at: null,
    ...overrides,
  };
}

// ── statusToChip (design assignment §3.2) ─────────────────────────────────────

describe("selectOtherActions (#1092)", () => {
  it("returns the terminal no-actions set for a Closed loan, regardless of variant", () => {
    expect(selectOtherActions("Closed", "performing")).toBe(
      CLOSED_OTHER_ACTIONS,
    );
    expect(selectOtherActions("Closed", "watchlist")).toBe(
      CLOSED_OTHER_ACTIONS,
    );
    expect(CLOSED_OTHER_ACTIONS.actions).toEqual([]);
    expect(CLOSED_OTHER_ACTIONS.note).toMatch(/closed/i);
  });

  it("keeps the per-variant sets for non-Closed loans", () => {
    expect(selectOtherActions("Performing", "performing")).toBe(
      PERFORMING_OTHER_ACTIONS,
    );
    expect(selectOtherActions("Watchlist", "watchlist")).toBe(
      WATCHLIST_OTHER_ACTIONS,
    );
    expect(selectOtherActions("Matured", "matured")).toBe(
      MATURED_OTHER_ACTIONS,
    );
    expect(selectOtherActions("Disbursing", "disbursing")).toBe(
      DISBURSING_OTHER_ACTIONS,
    );
    expect(selectOtherActions(null, "performing")).toBe(
      PERFORMING_OTHER_ACTIONS,
    );
  });
});

describe("statusToChip", () => {
  it("maps the raw on-chain status to the display chip + band", () => {
    expect(statusToChip("Performing")).toEqual({
      label: "Active",
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

  it("maps the backend-derived Disbursing display status (#862)", () => {
    expect(statusToChip("Disbursing")).toEqual({
      label: "Disbursing",
      band: "info",
      raw: "Disbursing",
    });
  });

  it("maps the past-maturity status (Past Due / Matured) to the Matured chip (#866)", () => {
    // Backend serves `Past Due`; the design renders this state as `Matured`.
    expect(statusToChip("Past Due")).toEqual({
      label: "Matured",
      band: "attention",
      raw: "Past Due",
    });
    expect(statusToChip("Matured")).toEqual({
      label: "Matured",
      band: "attention",
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
  it("builds the identity + mapped chip; meta shows the nearest payment date (#859/#941)", () => {
    const hero = buildHero("4488", makeEntry());
    expect(hero.title).toBe("Helios Metals · Lithium");
    expect(hero.status).toEqual({ label: "Active", band: "positive" });
    // Not overdue → the next-payment date (next_payment_timestamp = 30 Jun 2026).
    expect(hero.meta).toBe("Loan #4488 · Stellar · next payment 30 Jun 2026");
    expect(hero.backLabel).toBe("‹ Loans");
  });

  it("shows the overdue clause when days_overdue is set — 'payment N days late' (#941)", () => {
    const hero = buildHero(
      "4488",
      makeEntry({ status: "Matured", days_overdue: 5 }),
    );
    expect(hero.status).toEqual({ label: "Matured", band: "attention" });
    expect(hero.meta).toBe("Loan #4488 · Stellar · payment 5 days late");
  });

  it("degrades to the loan id only when no row is found (never fabricates)", () => {
    const hero = buildHero("999", undefined);
    expect(hero.title).toBe("Loan #999");
    expect(hero.status).toBeNull();
    expect(hero.meta).toBe("Loan #999");
  });

  it("omits the payment clause when no next-payment timestamp is served (no fabrication)", () => {
    const hero = buildHero("4488", makeEntry({ next_payment_timestamp: 0 }));
    expect(hero.meta).toBe("Loan #4488 · Stellar");
  });

  it("labels an EVM-chain loan with its chain name (#1537)", () => {
    const hero = buildHero(
      "7",
      makeEntry({ loan_id: "7", chain_id: 560048, next_payment_timestamp: 0 }),
    );
    expect(hero.meta).toBe("Loan #7 · Hoodi");
  });
});

// ── buildDocuments (issue #1039) ───────────────────────────────────────────────

describe("buildDocuments", () => {
  it("maps a served two-document array to DocumentDisplay[], preserving name/uri/order", () => {
    const docs = buildDocuments(
      makeEntry({
        documents: [
          { name: "Facility Agreement (extract)", uri: "ipfs://cid-1" },
          { name: "Offtake Contract", uri: "ipfs://cid-2" },
        ],
      }),
    );
    expect(docs).toEqual([
      { name: "Facility Agreement (extract)", uri: "ipfs://cid-1" },
      { name: "Offtake Contract", uri: "ipfs://cid-2" },
    ]);
  });

  it("returns [] for an undefined entry (loan-book row not found)", () => {
    expect(buildDocuments(undefined)).toEqual([]);
  });

  it("returns [] for an empty documents array", () => {
    expect(buildDocuments(makeEntry({ documents: [] }))).toEqual([]);
  });

  it("returns [] when documents is absent/malformed — never throws (A1's defensive guard)", () => {
    const entry = makeEntry();
    // Cast away the type to simulate an older API build omitting the key, or
    // serving a non-array shape.
    const missingKey = {
      ...entry,
      documents: undefined,
    } as unknown as LoanBookEntry;
    expect(() => buildDocuments(missingKey)).not.toThrow();
    expect(buildDocuments(missingKey)).toEqual([]);
    const nonArray = {
      ...entry,
      documents: "oops",
    } as unknown as LoanBookEntry;
    expect(buildDocuments(nonArray)).toEqual([]);
  });

  it("passes through a document with an empty uri rather than dropping it", () => {
    const docs = buildDocuments(
      makeEntry({ documents: [{ name: "Assay certificate", uri: "" }] }),
    );
    expect(docs).toEqual([{ name: "Assay certificate", uri: "" }]);
  });

  it("does not dedupe two documents sharing a name", () => {
    const docs = buildDocuments(
      makeEntry({
        documents: [
          { name: "Certificate of Analysis", uri: "ipfs://cid-a" },
          { name: "Certificate of Analysis", uri: "ipfs://cid-b" },
        ],
      }),
    );
    expect(docs).toHaveLength(2);
    expect(docs[0]).toEqual({
      name: "Certificate of Analysis",
      uri: "ipfs://cid-a",
    });
    expect(docs[1]).toEqual({
      name: "Certificate of Analysis",
      uri: "ipfs://cid-b",
    });
  });
});

// ── buildLifecycle (design assignment §3.2 status stepper) ────────────────────

describe("buildLifecycle", () => {
  const spine = (rawStatus: string | undefined) =>
    buildLifecycle(rawStatus).map((s) => `${s.label}:${s.state}`);

  it("is the 4-node happy-path spine — risk states are not sequential steps (#854)", () => {
    expect(buildLifecycle("Performing").map((s) => s.label)).toEqual([
      "Origination",
      "Disbursing",
      "Active",
      "Closed",
    ]);
  });

  it("a Performing loan's only forward step is Closed (no Past Due/Default upcoming)", () => {
    expect(spine("Performing")).toEqual([
      "Origination:done",
      "Disbursing:done",
      "Active:active",
      "Closed:pending",
    ]);
  });

  it("a Disbursing loan has the Disbursing node active (#862), live + Closed pending", () => {
    expect(spine("Disbursing")).toEqual([
      "Origination:done",
      "Disbursing:active",
      "Active:pending",
      "Closed:pending",
    ]);
  });

  it("maps the past-maturity status to a Matured live node (active, #866)", () => {
    const steps = buildLifecycle("Past Due");
    expect(steps[2]).toMatchObject({ label: "Matured", state: "active" });
    expect(steps[1]).toMatchObject({ label: "Disbursing", state: "done" });
  });

  it("shows the current live status on the live node — Watchlist", () => {
    const steps = buildLifecycle("WatchList");
    expect(steps[2]).toMatchObject({
      label: "Watchlist",
      state: "active",
      sub: "elevated risk",
    });
    expect(steps[3]).toMatchObject({ label: "Closed", state: "pending" });
  });

  it("maps legacy on-chain Matured to a Matured live node (still → Closed)", () => {
    const steps = buildLifecycle("Matured");
    expect(steps[2]).toMatchObject({ label: "Matured", state: "active" });
    expect(steps[3]).toMatchObject({ label: "Closed", state: "pending" });
  });

  it("shows Default as the live-node branch state (→ Closed)", () => {
    const steps = buildLifecycle("Default");
    expect(steps[2]).toMatchObject({ label: "Default", state: "active" });
    expect(steps[3]).toMatchObject({ label: "Closed", state: "pending" });
  });

  it("marks a Closed loan: spine done, Closed active", () => {
    expect(spine("Closed")).toEqual([
      "Origination:done",
      "Disbursing:done",
      "Active:done",
      "Closed:active",
    ]);
  });

  it("keeps the spine done for a present-but-unmapped status (live node active)", () => {
    const steps = buildLifecycle("???");
    expect(steps.map((s) => s.state)).toEqual([
      "done",
      "done",
      "active",
      "pending",
    ]);
    expect(steps[2]?.label).toBe("???");
  });

  it("leaves every step pending when there is no status (no loan-book row)", () => {
    expect(buildLifecycle(undefined).every((s) => s.state === "pending")).toBe(
      true,
    );
  });
});

// ── buildPriceCollateral ──────────────────────────────────────────────────────

// ── buildFinancials / buildRegistryState (issue #852) ─────────────────────────

function makeFinancials(
  overrides: Partial<LoanFinancialsResponse> = {},
): LoanFinancialsResponse {
  return {
    loan_id: "4488",
    status: "Performing",
    onchain_status: "Performing",
    epoch: {
      number: 1,
      current_apy_bps: 1000,
      start_date: "2026-06-18T18:17:37Z",
      maturity_date: "2029-08-19T04:04:17Z",
    },
    // Displayed exactly as served (issue #906 — no frontend rescaling).
    offtaker: "6300.000000",
    principal: "4800.000000",
    interest: "231.000000",
    fees: "69.000000",
    minted_yield: "115.500000",
    not_minted_yield: "115.500000",
    offtaker_outstanding: "0.000000",
    ...overrides,
  };
}

function makeFinancialsQuery(
  overrides: Partial<UseLoanFinancialsResult> = {},
): UseLoanFinancialsResult {
  return {
    data: undefined,
    isLoading: false,
    error: null,
    refetch: () => {},
    ...overrides,
  };
}

describe("buildFinancials", () => {
  it("maps the financials to registry rows (amounts displayed as served)", () => {
    const rows = buildFinancials(makeFinancials(), "LC at sight");
    expect(rows).toEqual([
      { label: "Status", value: "Performing", tag: "chain" },
      { label: "Protection", value: "LC at sight", tag: "relayer" },
      {
        label: "Epochs",
        value: "1 · 10.0% · 18 Jun 2026 → 19 Aug 2029",
        tag: "chain",
      },
      {
        label: "Recorded counters",
        value: "offtaker $6.3K · principal $4.8K · interest $231 · fees $69",
        tag: "chain",
      },
      { label: "Offtaker still owed", value: "$0 of $6.3K", tag: "computed" },
      { label: "Unminted yield", value: "$115.5", tag: "computed" },
      { label: "Custodian co-sig on mint", value: "—", tag: "relayer" },
    ]);
  });

  it("renders the served status verbatim under a Status label (#1441)", () => {
    const rows = buildFinancials(makeFinancials({ status: "WatchList" }));
    expect(rows[0]).toEqual({
      label: "Status",
      value: "WatchList",
      tag: "chain",
    });
  });

  it("renders — for the Epochs row when no epoch is on record (#857)", () => {
    const rows = buildFinancials(makeFinancials({ epoch: null }));
    expect(rows[2]).toEqual({ label: "Epochs", value: "—", tag: "chain" });
  });

  it("renders — for the Protection row when the loan-book row serves none (#1014)", () => {
    const rows = buildFinancials(makeFinancials());
    expect(rows[1]).toEqual({
      label: "Protection",
      value: "—",
      tag: "relayer",
    });
    expect(buildFinancials(makeFinancials(), "")[1]?.value).toBe("—");
  });
});

// ── buildSummaryTiles (issue #874) ────────────────────────────────────────────

describe("buildSummaryTiles", () => {
  it("maps performing tiles from loan-book + financials fields", () => {
    expect(
      buildSummaryTiles(makeEntry(), makeFinancials(), "performing"),
    ).toEqual([
      {
        label: "Facility / disbursed",
        value: "$4.8K / $3.96K",
        sub: "funded",
        subTone: "positive",
      },
      {
        label: "Repaid to date",
        value: "$6.3K",
        sub: "offtaker received",
        subTone: "muted",
      },
      {
        label: "Interest to distribute",
        value: "$115.5",
        sub: "not minted yield",
        subTone: "attention",
      },
    ]);
  });

  it("maps Facility / disbursed as principal / original_senior_tranche", () => {
    const tiles = buildSummaryTiles(
      makeEntry(),
      makeFinancials(),
      "performing",
    );
    expect(tiles[0]).toMatchObject({
      label: "Facility / disbursed",
      value: "$4.8K / $3.96K",
    });
  });

  it("maps Facility / senior as principal / 0 when disbursed is false", () => {
    const tiles = buildSummaryTiles(
      makeEntry({ disbursed: false }),
      makeFinancials(),
      "matured",
    );
    expect(tiles[0]).toEqual({
      label: "Facility / senior",
      value: "$4.8K / $0",
      sub: "—",
      subTone: "muted",
    });
  });

  it("maps watchlist days from days_on_watchlist only", () => {
    const tiles = buildSummaryTiles(
      makeEntry({
        status: "WatchList",
        days_on_watchlist: 18,
        watchlist_entered_at: 1_780_444_800,
      }),
      makeFinancials(),
      "watchlist",
    );
    expect(tiles[2]).toEqual({
      label: "Days on watchlist",
      value: "18",
      sub: "—",
      subTone: "muted",
    });
  });

  it("maps matured facility/senior and epoch APY", () => {
    expect(buildSummaryTiles(makeEntry(), makeFinancials(), "matured")).toEqual(
      [
        {
          label: "Facility / senior",
          value: "$4.8K / $4.8K",
          sub: "—",
          subTone: "muted",
        },
        {
          label: "Repaid to date",
          value: "$6.3K",
          sub: "offtaker received",
          subTone: "muted",
        },
        {
          label: "Rate · epochs",
          value: "10.0% p.a.",
          sub: "epoch 1",
          subTone: "muted",
        },
      ],
    );
  });

  it("renders — when no backend field is available", () => {
    expect(buildSummaryTiles(undefined, undefined, "matured")).toEqual([
      {
        label: "Facility / senior",
        value: "— / —",
        sub: "—",
        subTone: "muted",
      },
      {
        label: "Repaid to date",
        value: "—",
        sub: "offtaker received",
        subTone: "muted",
      },
      {
        label: "Rate · epochs",
        value: "—",
        sub: "—",
        subTone: "muted",
      },
    ]);
  });
});

describe("buildRegistryState", () => {
  it("maps a loading query to the loading state", () => {
    expect(
      buildRegistryState(makeFinancialsQuery({ isLoading: true })).state,
    ).toBe("loading");
  });

  it("maps a 404 to the neutral 'empty' state", () => {
    const view = buildRegistryState(
      makeFinancialsQuery({ error: new ApiError("not found", 404) }),
    );
    expect(view.state).toBe("empty");
    expect(view.rows).toEqual([]);
  });

  it("maps a non-404 error to the error state, friendly message, raw text only in errorDetails (#1037)", () => {
    const view = buildRegistryState(
      makeFinancialsQuery({ error: new ApiError("boom", 500) }),
    );
    expect(view.state).toBe("error");
    expect(view.errorMessage).toBe(
      "The service is temporarily unavailable. Please try again.",
    );
    expect(view.errorDetails).toBe("boom");
  });

  it("maps loaded data to the ready view-model with rows", () => {
    const view = buildRegistryState(
      makeFinancialsQuery({ data: makeFinancials() }),
    );
    expect(view.state).toBe("ready");
    expect(view.rows).toHaveLength(7);
  });

  it("threads the loan-book protection value into the Protection row (#1014)", () => {
    const view = buildRegistryState(
      makeFinancialsQuery({ data: makeFinancials() }),
      "CIF Incoterms 2020",
    );
    expect(view.rows.find((r) => r.label === "Protection")?.value).toBe(
      "CIF Incoterms 2020",
    );
  });
});

describe("buildRegistryState Debt token row (#1766)", () => {
  const financials = () => makeFinancialsQuery({ data: makeFinancials() });
  const DEBT = "CDEBT";
  const row = (
    deal: {
      data: { debt: string } | null | undefined;
      isPending: boolean;
      isError: boolean;
    } | null,
  ) =>
    buildRegistryState(financials(), null, deal).rows.find(
      (r) => r.label === "Debt token",
    );

  it("shows the registered debt address verbatim with the chain tag", () => {
    expect(
      row({ data: { debt: DEBT }, isPending: false, isError: false }),
    ).toEqual({
      label: "Debt token",
      value: DEBT,
      tag: "chain",
    });
  });

  it("shows — when not registered and on a read error", () => {
    expect(row({ data: null, isPending: false, isError: false })?.value).toBe(
      "—",
    );
    expect(
      row({ data: undefined, isPending: false, isError: true })?.value,
    ).toBe("—");
  });

  it("adds no row when no deal read is wired", () => {
    expect(row(null)).toBeUndefined();
  });
});

describe("allowedLifecycleTargets", () => {
  it.each([
    ["Performing", ["Performing", "WatchList"]],
    ["WatchList", ["Performing", "WatchList"]],
    ["Approved", ["Approved"]],
    ["Default", ["Default"]],
    ["Closed", []],
    ["Unknown", []],
    ["", []],
  ])("on-chain %s -> %j", (current, expected) => {
    expect(allowedLifecycleTargets(current)).toEqual(expected);
  });
});
