/**
 * Render tests for the Record Coupon full-page route
 * (`loans.$id_.record-coupon.tsx`, issue #882, Figma node `4116-11452`).
 *
 * Mocks the raw API hooks (`useLoanBook`, `useLoanFinancials`,
 * `useLoanWaterfall`) rather than the presenter — mirrors
 * `-loans.index.test.tsx`'s convention (raw hook mocked, real presenter +
 * route rendered) so the amount/date-input → base-unit scale conversion is
 * exercised end-to-end: typing a USD amount is asserted against the exact
 * argument `useLoanWaterfall` was called with. `Link`/`useNavigate` and
 * `Route.useParams` are patched, mirroring `-origination-detail-page.test.tsx`.
 *
 * Covers: the two cards + waterfall rows built from a mocked
 * `useLoanWaterfall` response; the suppressed "Next stage: principal
 * repayment" hint (absent for a normal interest coupon, present only in the
 * terminal full-principal-repayment case); the never-fabricated
 * "Recorded"/"Minted" chips (absent); loading / error / not-found states.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LoanBookResponse } from "@/api/useLoanBook";
import type { LoanFinancialsResponse } from "@/api/useLoanFinancials";
import type { WaterfallResponse } from "@/api/useLoanWaterfall";

const { mockNavigate, mockRecord } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockRecord: {
    mutate: vi.fn(),
    mutateAsync: vi.fn(() => Promise.resolve({ hash: "0xhash" })),
    reset: vi.fn(),
    isPending: false,
    isSuccess: false,
    error: null as Error | null,
    stage: null as string | null,
  },
}));

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
    "@tanstack/react-router",
  );
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    Link: ({
      children,
      to,
      params,
      ...rest
    }: {
      children: React.ReactNode;
      to: string;
      params?: Record<string, string>;
    } & Record<string, unknown>) => {
      const href = params
        ? Object.entries(params).reduce(
            (acc, [k, v]) => acc.replace(`$${k}`, v),
            to,
          )
        : to;
      return (
        <a href={href} {...rest}>
          {children}
        </a>
      );
    },
  };
});

vi.mock("@/api/useLoanBook", () => ({ useLoanBook: vi.fn() }));
vi.mock("@/api/useLoanFinancials", () => ({ useLoanFinancials: vi.fn() }));
vi.mock("@/api/useLoanWaterfall", () => ({ useLoanWaterfall: vi.fn() }));
// `useRecordPayment` pulls in @pipeline/wallet-connect + react-query — mock it.
vi.mock("@/api/useRecordPayment", () => ({
  useRecordPayment: () => mockRecord,
}));

import { useLoanBook } from "@/api/useLoanBook";
import { useLoanFinancials } from "@/api/useLoanFinancials";
import { useLoanWaterfall } from "@/api/useLoanWaterfall";
import { Route } from "./loans.$id_.record-coupon";

const mockUseLoanBook = vi.mocked(useLoanBook);
const mockUseLoanFinancials = vi.mocked(useLoanFinancials);
const mockUseLoanWaterfall = vi.mocked(useLoanWaterfall);

(Route as unknown as { useParams: () => { id: string } }).useParams = () => ({
  id: "4488",
});

function renderRoute() {
  const Page = Route.options.component as React.ComponentType;
  return render(<Page />);
}

const LOAN_BOOK_RESPONSE: LoanBookResponse = {
  summary: {
    total_deployed: "0.000000",
    total_collateral: null,
    senior_debt_coverage: null,
    avg_yield: null,
    avg_duration_days: null,
    deployed_senior: "0.000000",
    weighted_rate: null,
    weighted_tenor_days: null,
    at_risk_wl_and_default_senior: "0.000000",
    at_risk_wl_and_default_pct: null,
    top_concentration: null,
  },
  loans: [
    {
      loan_id: "4488",
      chain_id: 99_000_001,
      originator: "Helios Metals",
      borrower: "b1",
      commodity: "Lithium",
      // Served at full USD scale (#906 — displayed as-is, no client rescaling).
      principal: "2200000.000000",
      senior_outstanding: "1840000.000000",
      original_senior_tranche: "1840000.000000",
      maturity: 1_782_777_600,
      next_payment_timestamp: 1_782_777_600,
      days_overdue: null,
      ccr_reported_at: 0,
      spot_price: "10450",
      spot_change_7d: null,
      collateral: null,
      ltv: null,
      ccr_bps: null,
      duration_days: 88,
      rate: "0.130000",
      protection: null,
      status: "Performing",
      documents: [],
      repaid_to_date: "0.000000",
      disbursed: true,
      days_on_watchlist: null,
      watchlist_entered_at: null,
    },
  ],
};

const FINANCIALS_RESPONSE: LoanFinancialsResponse = {
  loan_id: "4488",
  status: "Performing",
  location: null,
  epoch: {
    number: 1,
    current_apy_bps: 1000,
    start_date: "2026-01-02T00:00:00Z",
    maturity_date: "2026-03-31T00:00:00Z",
  },
  offtaker: "2000.000000",
  principal: "1800.000000",
  interest: "40.000000",
  fees: "5.000000",
  minted_yield: "0.000000",
  not_minted_yield: "45.000000",
  // Served at full USD scale (#906 — displayed as-is): $2,000,000 still owed.
  offtaker_outstanding: "2000000.000000",
};

function ready() {
  mockUseLoanBook.mockReturnValue({
    data: LOAN_BOOK_RESPONSE,
    isLoading: false,
    error: null,
    refetch: () => {},
  });
  mockUseLoanFinancials.mockReturnValue({
    data: FINANCIALS_RESPONSE,
    isLoading: false,
    error: null,
    refetch: () => {},
  });
}

/**
 * A representative waterfall preview for a $45,000 interest-only coupon.
 * Backend values are raw 7-decimal SAC base units: $35,000 = "350000000000".
 */
const WATERFALL_INTEREST_ONLY: WaterfallResponse = {
  senior_principal_returned: "0",
  senior_coupon_net: "350000000000", // $35,000
  management_fee: "50000000000", // $5,000
  performance_fee: "30000000000", // $3,000
  oet_allocation: "20000000000", // $2,000
};

/** A terminal coupon whose principal-first waterfall fully repays the $1,840,000 outstanding senior. */
const WATERFALL_TERMINAL: WaterfallResponse = {
  senior_principal_returned: "18400000000000", // $1,840,000
  senior_coupon_net: "350000000000",
  management_fee: "50000000000",
  performance_fee: "30000000000",
  oet_allocation: "20000000000",
};

function mockWaterfall(
  data: WaterfallResponse | undefined,
  error: Error | null = null,
) {
  mockUseLoanWaterfall.mockReturnValue({ data, isLoading: false, error });
}

beforeEach(() => {
  mockUseLoanBook.mockReset();
  mockUseLoanFinancials.mockReset();
  mockUseLoanWaterfall.mockReset();
  mockWaterfall(undefined);
  mockNavigate.mockReset();
  mockRecord.mutateAsync = vi.fn(() => Promise.resolve({ hash: "0xhash" }));
  mockRecord.reset = vi.fn();
  mockRecord.isPending = false;
  mockRecord.error = null;
  mockRecord.stage = null;
});

describe("Record Coupon route — ready state", () => {
  beforeEach(ready);

  it("renders the header, back link, and title", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { name: "Record Coupon — Interest Only" }),
    ).toBeInTheDocument();
    const backLink = screen.getByRole("link", {
      name: "‹ Helios Metals · Lithium",
    });
    expect(backLink).toHaveAttribute("href", "/loans/4488");
  });

  it("disables the record button until an amount + preview are ready (#882)", () => {
    mockWaterfall(undefined);
    renderRoute();
    expect(screen.getByTestId("record-coupon-submit")).toBeDisabled();
  });

  it("records the payment on-chain with the built RepaymentData split (#882)", async () => {
    mockWaterfall(WATERFALL_INTEREST_ONLY);
    renderRoute();
    // Interest-only $45,000; carve-outs sum to it, so equity = 0.
    fireEvent.change(screen.getByTestId("record-coupon-amount"), {
      target: { value: "45000" },
    });
    const submit = screen.getByTestId("record-coupon-submit");
    // The amount is debounced (#882) — the button enables once it settles.
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);
    expect(mockRecord.mutateAsync).toHaveBeenCalledWith({
      loanId: 4488,
      repayment: {
        offtaker_received: "450000000000",
        senior_principal_repaid: "0",
        senior_interest: "350000000000",
        equity_distributed: "0",
        mgmt_fee: "50000000000",
        perf_fee: "30000000000",
        oet_alloc: "20000000000",
      },
    });
  });

  it("renders the static 'Your key · no cash moves' chip", () => {
    renderRoute();
    expect(screen.getByTestId("record-coupon-key-chip")).toHaveTextContent(
      "Your key · no cash moves",
    );
  });

  it("does NOT render the fabricated 'Recorded'/'Minted' progress chips (no backend source)", () => {
    renderRoute();
    expect(screen.queryByText(/Recorded ·/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Minted ·/)).not.toBeInTheDocument();
  });

  it("renders the info banner with the bolded 'recordPayment with zero principal' phrase", () => {
    renderRoute();
    const banner = screen.getByTestId("record-coupon-info-banner");
    expect(banner).toHaveTextContent(
      "A scheduled coupon is a recordPayment with zero principal",
    );
    expect(banner).toHaveTextContent("Deferred interest");
  });

  it("renders the coupon-period and senior-outstanding rows", () => {
    renderRoute();
    const left = screen.getByTestId("record-coupon-left-card");
    expect(left).toHaveTextContent("Helios Metals");
    expect(left).toHaveTextContent("Coupon period");
    expect(left).toHaveTextContent("2 Jan 2026 → 31 Mar 2026 · 88 days");
    expect(left).toHaveTextContent("Senior outstanding — unchanged");
    expect(left).toHaveTextContent("$1,840,000");
  });

  it("shows the 'Scheduled coupon' third row when a coupon is due (at/after maturity)", () => {
    // Freeze now at the epoch maturity (2026-03-31) → a coupon is due.
    const nowSpy = vi
      .spyOn(Date, "now")
      .mockReturnValue(new Date("2026-03-31T00:00:00Z").getTime());
    renderRoute();
    const left = screen.getByTestId("record-coupon-left-card");
    // Scheduled coupon = 10.0% p.a. × $1,840,000 × 88/365 ≈ $44,362 (client-side
    // projection, not backend-served — see -record-coupon.ts).
    expect(left).toHaveTextContent("Scheduled coupon (10.0% p.a.)");
    expect(left).toHaveTextContent("$44,362");
    expect(left).not.toHaveTextContent("Offtaker still owed after coupon");
    nowSpy.mockRestore();
  });

  it("shows the 'Offtaker still owed after coupon' third row for a simply-performing loan with no payment due", () => {
    // Freeze now well before maturity (mid-Jan, > 7 days out); the loan is
    // Performing → nothing due, so the owed row shows instead.
    const nowSpy = vi
      .spyOn(Date, "now")
      .mockReturnValue(new Date("2026-01-15T00:00:00Z").getTime());
    renderRoute();
    const left = screen.getByTestId("record-coupon-left-card");
    expect(left).toHaveTextContent("Offtaker still owed after coupon");
    // offtaker_outstanding "2000000.000000" displayed as-is (#906); no amount entered.
    expect(left).toHaveTextContent("$2,000,000");
    expect(left).not.toHaveTextContent("Scheduled coupon");
    nowSpy.mockRestore();
  });

  it("subtracts the entered amount from the 'Offtaker still owed after coupon' row in real time", () => {
    const nowSpy = vi
      .spyOn(Date, "now")
      .mockReturnValue(new Date("2026-01-15T00:00:00Z").getTime());
    renderRoute();
    // No debounce wait — the owed row tracks the live input immediately.
    fireEvent.change(screen.getByTestId("record-coupon-amount"), {
      target: { value: "500000" },
    });
    const left = screen.getByTestId("record-coupon-left-card");
    // 2,000,000 − 500,000 = 1,500,000.
    expect(left).toHaveTextContent("$1,500,000");
    nowSpy.mockRestore();
  });

  it("shows the 'Scheduled coupon' third row for a non-performing loan even when nothing is due", () => {
    const nowSpy = vi
      .spyOn(Date, "now")
      .mockReturnValue(new Date("2026-01-15T00:00:00Z").getTime());
    mockUseLoanBook.mockReturnValue({
      data: {
        ...LOAN_BOOK_RESPONSE,
        loans: [{ ...LOAN_BOOK_RESPONSE.loans[0]!, status: "WatchList" }],
      },
      isLoading: false,
      error: null,
      refetch: () => {},
    });
    renderRoute();
    const left = screen.getByTestId("record-coupon-left-card");
    expect(left).toHaveTextContent("Scheduled coupon (10.0% p.a.)");
    expect(left).not.toHaveTextContent("Offtaker still owed after coupon");
    nowSpy.mockRestore();
  });

  it("renders the in-card 'Record on the ledger' button and the recordPayment footer (node 4116-11295)", () => {
    renderRoute();
    const right = screen.getByTestId("record-coupon-right-card");
    const submit = screen.getByTestId("record-coupon-submit");
    // The primary action lives inside the right card, not a separate bottom row.
    expect(right).toContainElement(submit);
    expect(submit).toHaveTextContent("Record on the ledger");
    expect(right).toHaveTextContent(
      "recordPayment is pure accounting — increments the per-loan counters, emits PaymentRecorded, moves no USDC.",
    );
    // The old bottom Cancel action is gone (a back link at the top remains).
    expect(
      screen.queryByRole("link", { name: "Cancel" }),
    ).not.toBeInTheDocument();
  });

  it("renders the bank-wire check note on the left card", () => {
    renderRoute();
    expect(screen.getByTestId("record-coupon-left-card")).toHaveTextContent(
      "Check the amount against the correspondent bank wire before recording — there is no automatic bank feed.",
    );
  });

  it("renders the amount input and a read-only date fixed to today (#916)", () => {
    renderRoute();
    expect(screen.getByTestId("record-coupon-amount")).toHaveValue(null);
    const dateInput = screen.getByTestId("record-coupon-date");
    const today = new Date().toISOString().slice(0, 10);
    expect(dateInput).toHaveValue(today);
    expect(dateInput).toBeDisabled();
  });

  it("shows the 'enter an amount' placeholder before any amount is entered", () => {
    renderRoute();
    expect(
      screen.getByTestId("record-coupon-waterfall-empty"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("record-coupon-waterfall-row"),
    ).not.toBeInTheDocument();
  });

  it("passes the entered USD amount as raw SAC base units to useLoanWaterfall (debounced)", async () => {
    renderRoute();
    fireEvent.change(screen.getByTestId("record-coupon-amount"), {
      target: { value: "123.45678" },
    });
    // Amount is multiplied by 10^7 before the debounced waterfall request.
    await waitFor(() => {
      const lastCall =
        mockUseLoanWaterfall.mock.calls[
          mockUseLoanWaterfall.mock.calls.length - 1
        ]!;
      expect(lastCall[0]).toBe("4488");
      expect(lastCall[1]).toBe("1234567800");
    });
  });

  it("renders the waterfall rows from the mocked useLoanWaterfall response", async () => {
    mockWaterfall(WATERFALL_INTEREST_ONLY);
    renderRoute();
    fireEvent.change(screen.getByTestId("record-coupon-amount"), {
      target: { value: "45000" },
    });
    const rows = screen.getAllByTestId("record-coupon-waterfall-row");
    expect(rows).toHaveLength(6);
    const right = screen.getByTestId("record-coupon-right-card");
    // Values are skeleton-masked until the 400 ms debounce settles (#1049) —
    // wait for the first real figure before asserting the rest.
    await waitFor(() => expect(right).toHaveTextContent("$0"));
    expect(right).toHaveTextContent("Senior principal returned");
    expect(right).toHaveTextContent(
      "Interest-only coupon — principal stays deployed",
    );
    // Gross interest = 35,000 + 5,000 + 3,000 = $43,000, over the 88-day period.
    expect(right).toHaveTextContent("Gross interest (88 / 365 days)");
    expect(right).toHaveTextContent("$43,000");
    expect(right).toHaveTextContent("Management fee");
    expect(right).toHaveTextContent("$5,000");
    expect(right).toHaveTextContent("Performance fee");
    expect(right).toHaveTextContent("$3,000");
    expect(right).toHaveTextContent("OET allocation");
    expect(right).toHaveTextContent("$2,000");
    expect(right).toHaveTextContent("Net senior coupon → vault");
    expect(right).toHaveTextContent("$35,000");
    expect(right).toHaveTextContent("Mints to sPLUSD once the on-ramp lands");
  });

  it("keeps the full row set mounted with pulse skeletons while a recalculation is pending (#1049)", () => {
    mockWaterfall(WATERFALL_INTEREST_ONLY);
    renderRoute();
    fireEvent.change(screen.getByTestId("record-coupon-amount"), {
      target: { value: "45000" },
    });
    // Synchronously after typing the debounce has NOT settled: the card must
    // not collapse to the empty-state line — all six rows stay mounted with
    // their values masked, and the rows container is marked busy.
    expect(
      screen.queryByTestId("record-coupon-waterfall-empty"),
    ).not.toBeInTheDocument();
    expect(screen.getAllByTestId("record-coupon-waterfall-row")).toHaveLength(
      6,
    );
    expect(
      screen.getAllByTestId("record-coupon-waterfall-value-loading"),
    ).toHaveLength(6);
    expect(
      screen.getByTestId("record-coupon-waterfall-calculating"),
    ).toHaveAttribute("aria-busy", "true");
    // No dollar figure from the (mock-resolved) preview is readable yet.
    expect(
      screen.getByTestId("record-coupon-right-card"),
    ).not.toHaveTextContent("$43,000");
  });

  it("swaps the skeletons for values once the debounce settles (#1049)", async () => {
    mockWaterfall(WATERFALL_INTEREST_ONLY);
    renderRoute();
    fireEvent.change(screen.getByTestId("record-coupon-amount"), {
      target: { value: "45000" },
    });
    await waitFor(() =>
      expect(
        screen.queryByTestId("record-coupon-waterfall-value-loading"),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByTestId("record-coupon-waterfall-calculating"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("record-coupon-right-card")).toHaveTextContent(
      "$43,000",
    );
  });

  it("shows the empty-state line again when the amount is cleared (#1049)", async () => {
    mockWaterfall(WATERFALL_INTEREST_ONLY);
    renderRoute();
    const input = screen.getByTestId("record-coupon-amount");
    fireEvent.change(input, { target: { value: "45000" } });
    await waitFor(() =>
      expect(
        screen.queryByTestId("record-coupon-waterfall-value-loading"),
      ).not.toBeInTheDocument(),
    );
    mockWaterfall(undefined);
    fireEvent.change(input, { target: { value: "" } });
    await waitFor(() =>
      expect(
        screen.getByTestId("record-coupon-waterfall-empty"),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByTestId("record-coupon-waterfall-row"),
    ).not.toBeInTheDocument();
  });

  it("renders the green 'Components sum to received $<amount>' summary", async () => {
    mockWaterfall(WATERFALL_INTEREST_ONLY);
    renderRoute();
    fireEvent.change(screen.getByTestId("record-coupon-amount"), {
      target: { value: "45000" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("record-coupon-summary")).toHaveTextContent(
        "Components sum to received $45,000",
      ),
    );
  });

  it("on a waterfall error keeps static '—' rows (no pulse) with the error shown below (#1049)", async () => {
    mockWaterfall(undefined, new Error("boom"));
    renderRoute();
    fireEvent.change(screen.getByTestId("record-coupon-amount"), {
      target: { value: "45000" },
    });
    // Once the debounce settles, the errored preview is NOT "calculating":
    // skeletons go away, the rows stay mounted with "—" values (stable
    // height), and the error block renders beneath them.
    await waitFor(() =>
      expect(
        screen.queryByTestId("record-coupon-waterfall-value-loading"),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getAllByTestId("record-coupon-waterfall-row")).toHaveLength(
      6,
    );
    expect(
      screen.queryByTestId("record-coupon-waterfall-calculating"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("record-coupon-waterfall-error"),
    ).toBeInTheDocument();
  });

  it("does NOT render the 'Next stage: principal repayment' hint for a normal interest coupon", () => {
    mockWaterfall(WATERFALL_INTEREST_ONLY);
    renderRoute();
    fireEvent.change(screen.getByTestId("record-coupon-amount"), {
      target: { value: "45000" },
    });
    expect(
      screen.queryByTestId("record-coupon-terminal-hint"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Next stage: principal repayment/),
    ).not.toBeInTheDocument();
  });

  it("renders the terminal-close hint ONLY when the coupon fully repays the outstanding senior principal", async () => {
    mockWaterfall(WATERFALL_TERMINAL);
    renderRoute();
    // Outstanding senior is $1,840,000 — enter an amount that covers it.
    fireEvent.change(screen.getByTestId("record-coupon-amount"), {
      target: { value: "1900000" },
    });
    await waitFor(() =>
      expect(
        screen.getByTestId("record-coupon-terminal-hint"),
      ).toBeInTheDocument(),
    );
  });

  it("does NOT render the terminal hint when the waterfall returns full principal but the entered amount doesn't cover it", () => {
    // Defensive: senior_principal_returned alone should never trigger the hint
    // without the entered-amount guard.
    mockWaterfall(WATERFALL_TERMINAL);
    renderRoute();
    fireEvent.change(screen.getByTestId("record-coupon-amount"), {
      target: { value: "100" },
    });
    expect(
      screen.queryByTestId("record-coupon-terminal-hint"),
    ).not.toBeInTheDocument();
  });
});

describe("Record Coupon route — top-level states", () => {
  it("renders a loading skeleton while the loan book is loading", () => {
    mockUseLoanBook.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: () => {},
    });
    mockUseLoanFinancials.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: () => {},
    });
    renderRoute();
    expect(screen.getByTestId("record-coupon-loading")).toBeInTheDocument();
  });

  it("renders the friendly loan-load error, not the raw backend text — raw only reachable via View details (#1037)", async () => {
    mockUseLoanBook.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("network error"),
      refetch: () => {},
    });
    mockUseLoanFinancials.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      refetch: () => {},
    });
    renderRoute();
    const alert = screen.getByTestId("record-coupon-error");
    expect(alert).toHaveTextContent("Failed to load the loan.");
    expect(alert).not.toHaveTextContent("network error");

    await userEvent.click(screen.getByTestId("inline-error-view-details"));
    expect(screen.getByTestId("error-details-raw")).toHaveTextContent(
      "network error",
    );
  });

  it("renders a not-found state with a back link to /loans when the loan isn't in the book", () => {
    mockUseLoanBook.mockReturnValue({
      data: { ...LOAN_BOOK_RESPONSE, loans: [] },
      isLoading: false,
      error: null,
      refetch: () => {},
    });
    mockUseLoanFinancials.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      refetch: () => {},
    });
    renderRoute();
    const notFound = screen.getByTestId("record-coupon-not-found");
    expect(notFound).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Loans" })).toHaveAttribute(
      "href",
      "/loans",
    );
  });
});
