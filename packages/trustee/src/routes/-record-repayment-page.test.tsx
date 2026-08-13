/**
 * Render tests for the Record Repayment — Principal full-page route
 * (`loans.$id_.record-repayment.tsx`, issue #884, Figma node `4116-11621`).
 *
 * Mocks the raw API hooks (`useLoanBook`, `useLoanFinancials`,
 * `useLoanWaterfall`) rather than the presenter, and mocks `useRecordPayment`
 * / `useCloseLoan` (both pull in `@pipeline/wallet-connect`) — mirrors
 * `-record-coupon-page.test.tsx`'s convention.
 *
 * Covers: the two cards + the REAL (non-zero, non-disabled) senior-principal
 * row; `buildRepaymentInput`-equivalent recording with real principal +
 * equity residual; the Close-loan action hidden until fully repaid and shown
 * once terminal, calling `useCloseLoan` with the resolved `reason`; loading /
 * error / not-found states.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LoanBookResponse } from "@/api/useLoanBook";
import type { LoanFinancialsResponse } from "@/api/useLoanFinancials";
import type { WaterfallResponse } from "@/api/useLoanWaterfall";

const { mockNavigate, mockRecord, mockCloseLoan } = vi.hoisted(() => ({
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
  mockCloseLoan: {
    mutate: vi.fn(),
    mutateAsync: vi.fn(() => Promise.resolve({ hash: "0xclosehash" })),
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
// `useRecordPayment` / `useCloseLoan` pull in @pipeline/wallet-connect + react-query — mock both.
vi.mock("@/api/useRecordPayment", () => ({
  useRecordPayment: () => mockRecord,
}));
vi.mock("@/api/useCloseLoan", () => ({
  useCloseLoan: () => mockCloseLoan,
}));

import { useLoanBook } from "@/api/useLoanBook";
import { useLoanFinancials } from "@/api/useLoanFinancials";
import { useLoanWaterfall } from "@/api/useLoanWaterfall";
import { Route } from "./loans.$id_.record-repayment";

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
      principal: "5000000.000000",
      senior_outstanding: "4800000.000000",
      original_senior_tranche: "4800000.000000",
      // 24 Jun 2026 00:00:00 UTC.
      maturity: 1_782_172_800,
      next_payment_timestamp: 1_782_172_800,
      days_overdue: null,
      ccr_reported_at: 0,
      spot_price: "10450",
      spot_change_7d: null,
      collateral: null,
      ltv: null,
      ccr_bps: null,
      duration_days: 85,
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
    number: 2,
    current_apy_bps: 1000,
    start_date: "2026-03-31T00:00:00Z",
    maturity_date: "2026-06-24T00:00:00Z",
  },
  offtaker: "6150.000000",
  principal: "4800.000000",
  interest: "115.500000",
  fees: "27.000000",
  minted_yield: "0.000000",
  not_minted_yield: "0.000000",
  // Served at full USD scale (#906 — displayed as-is): $6,150,000 still owed.
  offtaker_outstanding: "6150000.000000",
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

/** `ready()` with per-field checklist overrides (senior / offtaker / unminted). */
function readyWith(overrides: {
  senior?: string;
  offtaker?: string;
  notMinted?: string;
}) {
  mockUseLoanBook.mockReturnValue({
    data: {
      ...LOAN_BOOK_RESPONSE,
      loans: [
        {
          ...LOAN_BOOK_RESPONSE.loans[0]!,
          senior_outstanding:
            overrides.senior ?? LOAN_BOOK_RESPONSE.loans[0]!.senior_outstanding,
        },
      ],
    },
    isLoading: false,
    error: null,
    refetch: () => {},
  });
  mockUseLoanFinancials.mockReturnValue({
    data: {
      ...FINANCIALS_RESPONSE,
      offtaker_outstanding:
        overrides.offtaker ?? FINANCIALS_RESPONSE.offtaker_outstanding,
      not_minted_yield:
        overrides.notMinted ?? FINANCIALS_RESPONSE.not_minted_yield,
    },
    isLoading: false,
    error: null,
    refetch: () => {},
  });
}

/**
 * A terminal waterfall preview: a $6,150,000 final payment that fully repays
 * the $4,800,000 outstanding senior principal. Backend values are raw
 * 7-decimal SAC base units.
 */
const WATERFALL_TERMINAL: WaterfallResponse = {
  senior_principal_returned: "48000000000000", // $4,800,000 — REAL, not $0 (#884)
  senior_coupon_net: "1155000000000",
  management_fee: "120000000000",
  performance_fee: "150000000000",
  oet_allocation: "75000000000",
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
  mockCloseLoan.mutateAsync = vi.fn(() =>
    Promise.resolve({ hash: "0xclosehash" }),
  );
  mockCloseLoan.reset = vi.fn();
  mockCloseLoan.isPending = false;
  mockCloseLoan.error = null;
  mockCloseLoan.stage = null;
});

describe("Record Repayment route — ready state", () => {
  beforeEach(ready);

  it("renders the header, back link, and title", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { name: "Record Repayment — Principal" }),
    ).toBeInTheDocument();
    const backLink = screen.getByRole("link", {
      name: "‹ Helios Metals · Lithium",
    });
    expect(backLink).toHaveAttribute("href", "/loans/4488");
  });

  it("renders the static 'Your key · no cash moves' chip and no fabricated 'Recorded' chip", () => {
    renderRoute();
    expect(screen.getByTestId("record-repayment-key-chip")).toHaveTextContent(
      "Your key · no cash moves",
    );
    expect(screen.queryByText(/Recorded ·/)).not.toBeInTheDocument();
  });

  it("renders a read-only date fixed to today (#916)", () => {
    renderRoute();
    const dateInput = screen.getByTestId("record-repayment-date");
    const today = new Date().toISOString().slice(0, 10);
    expect(dateInput).toHaveValue(today);
    expect(dateInput).toBeDisabled();
  });

  it("renders the left card's commodity, final period, senior outstanding, and offtaker-owed rows", () => {
    renderRoute();
    const left = screen.getByTestId("record-repayment-left-card");
    expect(left).toHaveTextContent("Helios Metals");
    expect(left).toHaveTextContent("Commodity");
    expect(left).toHaveTextContent("Lithium");
    expect(left).toHaveTextContent("Final period");
    expect(left).toHaveTextContent("31 Mar 2026 → 24 Jun 2026 · 85 days");
    expect(left).toHaveTextContent("Senior outstanding before");
    expect(left).toHaveTextContent("$4,800,000");
    expect(left).toHaveTextContent("Offtaker owed");
    expect(left).toHaveTextContent("$6,150,000");
  });

  it("disables the record button until an amount + preview are ready", () => {
    mockWaterfall(undefined);
    renderRoute();
    expect(screen.getByTestId("record-repayment-submit")).toBeDisabled();
  });

  it("prefills the amount with the full remaining owed and locks it read-only — no partial principal repayment (#884)", async () => {
    mockWaterfall(undefined);
    renderRoute();
    const amount = screen.getByTestId("record-repayment-amount");
    // offtaker_outstanding "6150000.000000" displayed as-is (#906) = $6,150,000.
    await waitFor(() => expect(amount).toHaveValue("6,150,000"));
    // A principal repayment always pays it ALL — the input is disabled.
    expect(amount).toBeDisabled();
  });

  it("keeps the full row set mounted with pulse skeletons while a recalculation is pending (#1049)", async () => {
    mockWaterfall(WATERFALL_TERMINAL);
    renderRoute();
    fireEvent.change(screen.getByTestId("record-repayment-amount"), {
      target: { value: "6150000" },
    });
    expect(
      screen.queryByTestId("record-repayment-waterfall-empty"),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByTestId("record-repayment-waterfall-row"),
    ).toHaveLength(7);
    expect(
      screen.getAllByTestId("record-repayment-waterfall-value-loading"),
    ).toHaveLength(7);
    expect(
      screen.getByTestId("record-repayment-waterfall-calculating"),
    ).toHaveAttribute("aria-busy", "true");
    await waitFor(() =>
      expect(
        screen.queryByTestId("record-repayment-waterfall-value-loading"),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByTestId("record-repayment-waterfall-calculating"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("record-repayment-right-card")).toHaveTextContent(
      "$4,800,000",
    );
  });

  it("renders the waterfall rows with the REAL (non-zero, non-disabled) senior-principal row", async () => {
    mockWaterfall(WATERFALL_TERMINAL);
    renderRoute();
    fireEvent.change(screen.getByTestId("record-repayment-amount"), {
      target: { value: "6150000" },
    });
    // The equity/residual figure depends on the debounced amount (via
    // `buildRepaymentInput`) — wait for it to settle before asserting.
    await waitFor(() =>
      expect(screen.getByTestId("record-repayment-submit")).toBeEnabled(),
    );
    const right = screen.getByTestId("record-repayment-right-card");
    expect(
      screen.getAllByTestId("record-repayment-waterfall-row"),
    ).toHaveLength(7);
    expect(right).toHaveTextContent("Senior principal returned");
    expect(right).toHaveTextContent("$4,800,000");
    expect(right).toHaveTextContent("On-ramped, no mint");
    expect(right).toHaveTextContent("Gross interest (final period)");
    // Gross interest = 115,500 + 12,000 + 15,000 = $142,500.
    expect(right).toHaveTextContent("$142,500");
    expect(right).toHaveTextContent("Management fee");
    expect(right).toHaveTextContent("$12,000");
    expect(right).toHaveTextContent("Performance fee");
    expect(right).toHaveTextContent("$15,000");
    expect(right).toHaveTextContent("OET allocation");
    expect(right).toHaveTextContent("$7,500");
    expect(right).toHaveTextContent("Net senior coupon → vault");
    expect(right).toHaveTextContent("$115,500");
    // Originator residual (equity) = 6,150,000 − (4,800,000 + 115,500 + 12,000 + 15,000 + 7,500) = $1,200,000.
    expect(right).toHaveTextContent("Originator residual");
    expect(right).toHaveTextContent("$1,200,000");
    expect(right).toHaveTextContent("Stays USD off-chain, not on-ramped");
  });

  it("dims the Originator residual row but NOT the real senior-principal row (Figma)", () => {
    mockWaterfall(WATERFALL_TERMINAL);
    renderRoute();
    fireEvent.change(screen.getByTestId("record-repayment-amount"), {
      target: { value: "6150000" },
    });
    const rows = screen.getAllByTestId("record-repayment-waterfall-row");
    const seniorRow = rows.find((r) =>
      r.textContent?.includes("Senior principal returned"),
    )!;
    const residualRow = rows.find((r) =>
      r.textContent?.includes("Originator residual"),
    )!;
    // Senior principal returned is real money here (unlike #882's forced $0) — not dimmed.
    expect(seniorRow).not.toHaveStyle({ opacity: "0.5" });
    // Originator residual stays USD off-chain → dimmed, matching the Figma.
    expect(residualRow).toHaveStyle({ opacity: "0.5" });
  });

  it("renders the green 'Components sum to received $<amount>' summary", async () => {
    mockWaterfall(WATERFALL_TERMINAL);
    renderRoute();
    fireEvent.change(screen.getByTestId("record-repayment-amount"), {
      target: { value: "6150000" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("record-repayment-summary")).toHaveTextContent(
        "Components sum to received $6,150,000",
      ),
    );
  });

  it("renders the Close-loan action as a full-width 'Next step — close loan' button (the old static box is gone)", () => {
    renderRoute();
    expect(
      screen.getByTestId("record-repayment-close-submit"),
    ).toHaveTextContent("Next step — close loan");
    expect(
      screen.queryByTestId("record-repayment-next-step"),
    ).not.toBeInTheDocument();
  });

  it("records the payment on-chain with the REAL principal carried into senior_principal_repaid (#884)", async () => {
    mockWaterfall(WATERFALL_TERMINAL);
    renderRoute();
    fireEvent.change(screen.getByTestId("record-repayment-amount"), {
      target: { value: "6150000" },
    });
    const submit = screen.getByTestId("record-repayment-submit");
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);
    expect(mockRecord.mutateAsync).toHaveBeenCalledWith({
      loanId: 4488,
      repayment: {
        offtaker_received: "61500000000000",
        senior_principal_repaid: "48000000000000",
        senior_interest: "1155000000000",
        equity_distributed: "12000000000000",
        mgmt_fee: "120000000000",
        perf_fee: "150000000000",
        oet_alloc: "75000000000",
      },
    });
  });

  it("keeps Close-loan DISABLED after a terminal amount until the payment is recorded (#884 gating)", async () => {
    mockWaterfall(WATERFALL_TERMINAL);
    renderRoute();
    fireEvent.change(screen.getByTestId("record-repayment-amount"), {
      target: { value: "6150000" },
    });
    // The record action is ready…
    await waitFor(() =>
      expect(screen.getByTestId("record-repayment-submit")).toBeEnabled(),
    );
    // …but a terminal amount alone no longer enables close — the payment must
    // actually be recorded first.
    expect(screen.getByTestId("record-repayment-close-submit")).toBeDisabled();
  });

  it("ENABLES Close-loan once the terminal payment has been recorded and the refetched financials cover the offtaker", async () => {
    mockRecord.isSuccess = true;
    readyWith({ offtaker: "0.000000" });
    mockWaterfall(WATERFALL_TERMINAL);
    renderRoute();
    await waitFor(() =>
      expect(screen.getByTestId("record-repayment-close-submit")).toBeEnabled(),
    );
    // The record button now reads as complete and is locked to prevent a
    // double-record.
    const submit = screen.getByTestId("record-repayment-submit");
    expect(submit).toHaveTextContent("Payment recorded");
    expect(submit).toBeDisabled();
  });

  it("ENABLES Close-loan immediately when the whole checklist is green (revisiting an already-repaid loan)", () => {
    readyWith({ senior: "0", offtaker: "0.000000" });
    renderRoute();
    expect(screen.getByTestId("record-repayment-close-submit")).toBeEnabled();
    expect(screen.getAllByTestId("record-repayment-check-ok")).toHaveLength(3);
  });

  it("calls useCloseLoan with ScheduledMaturity when now is at/after the loan's maturity, and navigates on success", async () => {
    // Loan-book fixture's maturity is 24 Jun 2026 — freeze `Date.now()` at that
    // instant without touching real timers (the amount debounce still needs to
    // fire on the real clock).
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_782_172_800 * 1000);
    // The payment is recorded and the refetched financials cover the offtaker,
    // so the close action can enable.
    mockRecord.isSuccess = true;
    readyWith({ offtaker: "0.000000" });
    mockWaterfall(WATERFALL_TERMINAL);
    renderRoute();
    const closeBtn = screen.getByTestId("record-repayment-close-submit");
    await waitFor(() => expect(closeBtn).toBeEnabled(), { timeout: 2000 });
    fireEvent.click(closeBtn);
    await waitFor(() =>
      expect(mockCloseLoan.mutateAsync).toHaveBeenCalledWith({
        loanId: 4488,
        reason: "ScheduledMaturity",
      }),
    );
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/loans/$id",
        params: { id: "4488" },
      }),
    );
    nowSpy.mockRestore();
  });

  it("calls useCloseLoan with EarlyRepayment when now is before the loan's maturity", async () => {
    const nowSpy = vi
      .spyOn(Date, "now")
      .mockReturnValue(1_782_172_800 * 1000 - 86_400_000);
    // The payment is recorded and the refetched financials cover the offtaker,
    // so the close action can enable.
    mockRecord.isSuccess = true;
    readyWith({ offtaker: "0.000000" });
    mockWaterfall(WATERFALL_TERMINAL);
    renderRoute();
    const closeBtn = screen.getByTestId("record-repayment-close-submit");
    await waitFor(() => expect(closeBtn).toBeEnabled(), { timeout: 2000 });
    fireEvent.click(closeBtn);
    await waitFor(() =>
      expect(mockCloseLoan.mutateAsync).toHaveBeenCalledWith({
        loanId: 4488,
        reason: "EarlyRepayment",
      }),
    );
    nowSpy.mockRestore();
  });

  it("does not navigate away when close_loan rejects (stays on the page to retry)", async () => {
    mockCloseLoan.mutateAsync = vi.fn(() =>
      Promise.reject(new Error("close_loan trapped")),
    );
    readyWith({ senior: "0", offtaker: "0.000000" });
    renderRoute();
    fireEvent.click(screen.getByTestId("record-repayment-close-submit"));
    await waitFor(() => expect(mockCloseLoan.mutateAsync).toHaveBeenCalled());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("renders the friendly close_loan error, not the raw backend text — raw only reachable via View details (#1037)", async () => {
    mockCloseLoan.error = new Error("close_loan trapped");
    mockUseLoanBook.mockReturnValue({
      data: {
        ...LOAN_BOOK_RESPONSE,
        loans: [{ ...LOAN_BOOK_RESPONSE.loans[0]!, senior_outstanding: "0" }],
      },
      isLoading: false,
      error: null,
      refetch: () => {},
    });
    renderRoute();
    const alert = screen.getByTestId("record-repayment-close-error");
    expect(alert).toHaveTextContent("Failed to close this loan.");
    expect(alert).not.toHaveTextContent("close_loan trapped");

    await userEvent.click(screen.getByTestId("inline-error-view-details"));
    expect(screen.getByTestId("error-details-raw")).toHaveTextContent(
      "close_loan trapped",
    );
  });
});

describe("Record Repayment route — offtaker fully paid (#1090)", () => {
  function fullyPaid() {
    mockUseLoanBook.mockReturnValue({
      data: LOAN_BOOK_RESPONSE,
      isLoading: false,
      error: null,
      refetch: () => {},
    });
    mockUseLoanFinancials.mockReturnValue({
      data: { ...FINANCIALS_RESPONSE, offtaker_outstanding: "0.000000" },
      isLoading: false,
      error: null,
      refetch: () => {},
    });
  }

  beforeEach(() => {
    mockRecord.isSuccess = false;
  });

  it("shows the fully-repaid notice instead of the form, waterfall placeholder, and record action", () => {
    fullyPaid();
    renderRoute();
    expect(screen.getByTestId("record-repayment-fully-paid")).toHaveTextContent(
      "nothing left to record",
    );
    expect(
      screen.queryByTestId("record-repayment-amount"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("record-repayment-date"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("record-repayment-submit"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("record-repayment-waterfall-empty"),
    ).not.toBeInTheDocument();
  });

  it("ENABLES Close-loan when the offtaker owes nothing AND the hard gates are green, and clicking closes with the resolved reason", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_782_172_800 * 1000);
    readyWith({ senior: "0", offtaker: "0.000000" });
    renderRoute();
    const closeBtn = screen.getByTestId("record-repayment-close-submit");
    expect(closeBtn).toBeEnabled();
    fireEvent.click(closeBtn);
    await waitFor(() =>
      expect(mockCloseLoan.mutateAsync).toHaveBeenCalledWith({
        loanId: 4488,
        reason: "ScheduledMaturity",
      }),
    );
    nowSpy.mockRestore();
  });

  it("keeps Close-loan DISABLED on a fully-paid offtaker while the senior outstanding is non-zero (hard gate)", () => {
    fullyPaid();
    renderRoute();
    expect(
      screen.getByTestId("record-repayment-fully-paid"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("record-repayment-close-submit")).toBeDisabled();
    const unmet = screen.getAllByTestId("record-repayment-check-unmet");
    expect(unmet).toHaveLength(1);
    expect(unmet[0]).toHaveTextContent("Senior principal outstanding is zero");
    expect(unmet[0]).toHaveTextContent("$4,800,000 outstanding");
  });

  it("drops the stale entered amount and shows the notice when a refetch brings offtaker owed to zero (recorded in the sibling coupon flow)", async () => {
    ready();
    mockWaterfall(WATERFALL_TERMINAL);
    const rendered = renderRoute();
    fireEvent.change(screen.getByTestId("record-repayment-amount"), {
      target: { value: "6150000" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("record-repayment-submit")).toBeEnabled(),
    );
    mockUseLoanFinancials.mockReturnValue({
      data: { ...FINANCIALS_RESPONSE, offtaker_outstanding: "0.000000" },
      isLoading: false,
      error: null,
      refetch: () => {},
    });
    const Page = Route.options.component as React.ComponentType;
    rendered.rerender(<Page />);
    expect(
      screen.getByTestId("record-repayment-fully-paid"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("record-repayment-submit"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("record-repayment-close-submit")).toBeDisabled();
    expect(
      screen.getAllByTestId("record-repayment-check-unmet")[0],
    ).toHaveTextContent("Senior principal outstanding is zero");
  });

  it("keeps the just-recorded confirmation when this page's own record succeeded (no notice swap)", () => {
    mockRecord.isSuccess = true;
    fullyPaid();
    mockWaterfall(WATERFALL_TERMINAL);
    renderRoute();
    expect(
      screen.queryByTestId("record-repayment-fully-paid"),
    ).not.toBeInTheDocument();
    const submit = screen.getByTestId("record-repayment-submit");
    expect(submit).toHaveTextContent("Payment recorded");
    expect(screen.getByTestId("record-repayment-close-submit")).toBeEnabled();
  });
});

describe("Record Repayment route — close-loan checklist", () => {
  beforeEach(() => {
    mockRecord.isSuccess = false;
  });

  it("requires the manual offtaker acknowledgement on an early payoff / waiver (checkbox enables close)", () => {
    readyWith({ senior: "0" });
    renderRoute();
    const closeBtn = screen.getByTestId("record-repayment-close-submit");
    expect(closeBtn).toBeDisabled();
    const ack = screen.getByTestId("record-repayment-offtaker-ack");
    fireEvent.click(ack);
    expect(closeBtn).toBeEnabled();
    fireEvent.click(ack);
    expect(closeBtn).toBeDisabled();
  });

  it("keeps Close-loan DISABLED while yield is unminted — hard gate, no manual override offered", () => {
    readyWith({
      senior: "0",
      offtaker: "0.000000",
      notMinted: "280.910000",
    });
    renderRoute();
    expect(screen.getByTestId("record-repayment-close-submit")).toBeDisabled();
    const unmet = screen.getAllByTestId("record-repayment-check-unmet");
    expect(unmet).toHaveLength(1);
    expect(unmet[0]).toHaveTextContent("Nothing left to mint on either leg");
    expect(unmet[0]).toHaveTextContent("$281 unminted — no manual override");
    expect(
      screen.queryByTestId("record-repayment-offtaker-ack"),
    ).not.toBeInTheDocument();
  });

  it("renders all three checklist items with the served detail values", () => {
    ready();
    renderRoute();
    const checklist = screen.getByTestId("record-repayment-close-checklist");
    expect(checklist).toHaveTextContent("Senior principal outstanding is zero");
    expect(checklist).toHaveTextContent("$4,800,000 outstanding");
    expect(checklist).toHaveTextContent("Nothing left to mint on either leg");
    expect(checklist).toHaveTextContent(
      "Acknowledge remaining offtaker balance (early payoff or waiver)",
    );
  });
});

describe("Record Repayment route — top-level states", () => {
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
    expect(screen.getByTestId("record-repayment-loading")).toBeInTheDocument();
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
    const alert = screen.getByTestId("record-repayment-error");
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
    const notFound = screen.getByTestId("record-repayment-not-found");
    expect(notFound).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Loans" })).toHaveAttribute(
      "href",
      "/loans",
    );
  });
});
