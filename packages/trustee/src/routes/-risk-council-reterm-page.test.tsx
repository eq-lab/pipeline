/**
 * Render tests for the Risk Council "Amend economics — off-cycle re-term"
 * route (`risk-council.reterm.$id.tsx`, issue #782, flow 11, Figma
 * `4116-13481`).
 *
 * Mocks the raw API hooks (`useLoanBook`, `useLoanFinancials`) rather than the
 * presenter — mirrors `-risk-council-escalate-page.test.tsx`. Covers: the
 * "Risk proposal" header + MOCK timestamp, the three chips, the REAL Current
 * terms (loan/coupon/CCR), the MOCK Proposed terms, the read-only (disabled)
 * "View Safe proposal" button, and the loading / error / not-found states.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { LoanBookResponse } from "@/api/useLoanBook";
import type { LoanFinancialsResponse } from "@/api/useLoanFinancials";

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
    "@tanstack/react-router",
  );
  return {
    ...actual,
    Link: ({
      children,
      to,
      ...rest
    }: {
      children: React.ReactNode;
      to: string;
    } & Record<string, unknown>) => (
      <a href={to} {...rest}>
        {children}
      </a>
    ),
  };
});

vi.mock("@/api/useLoanBook", () => ({ useLoanBook: vi.fn() }));
vi.mock("@/api/useLoanFinancials", () => ({ useLoanFinancials: vi.fn() }));

import { useLoanBook } from "@/api/useLoanBook";
import { useLoanFinancials } from "@/api/useLoanFinancials";
import { Route } from "./risk-council.reterm.$id";

const mockUseLoanBook = vi.mocked(useLoanBook);
const mockUseLoanFinancials = vi.mocked(useLoanFinancials);

(Route as unknown as { useParams: () => { id: string } }).useParams = () => ({
  id: "4471",
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
      loan_id: "4471",
      chain_id: 99_000_001,
      originator: "Delta Commodities",
      borrower: "b1",
      commodity: "Coffee",
      principal: "2300000.000000",
      senior_outstanding: "1840000.000000",
      original_senior_tranche: "1840000.000000",
      // 15 Aug 2026 00:00:00 UTC.
      maturity: 1_786_838_400,
      next_payment_timestamp: 1_786_838_400,
      days_overdue: null,
      ccr_reported_at: 0,
      spot_price: "4500",
      spot_change_7d: "-0.18",
      collateral: "2106000.000000",
      ltv: null,
      // 114%.
      ccr_bps: 11_400,
      duration_days: 88,
      rate: "0.120000",
      protection: null,
      status: "WatchList",
      repaid_to_date: "0.000000",
      disbursed: true,
      days_on_watchlist: 18,
      watchlist_entered_at: 0,
    },
  ],
};

const FINANCIALS_RESPONSE: LoanFinancialsResponse = {
  loan_id: "4471",
  status: "WatchList",
  location: null,
  // Current epoch coupon = 12.0%.
  epoch: {
    number: 1,
    current_apy_bps: 1200,
    start_date: "2026-05-15T00:00:00Z",
    maturity_date: "2026-08-15T00:00:00Z",
  },
  offtaker: "2000000.000000",
  principal: "1800000.000000",
  interest: "0.000000",
  fees: "0.000000",
  minted_yield: "0.000000",
  not_minted_yield: "0.000000",
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

beforeEach(() => {
  mockUseLoanBook.mockReset();
  mockUseLoanFinancials.mockReset();
});

describe("Risk Council — Off-cycle re-term route (ready)", () => {
  beforeEach(ready);

  it("renders the 'Risk proposal' header, the MOCK timestamp, and the three chips", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { name: "Risk proposal" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("risk-council-reterm-timestamp")).toHaveTextContent(
      "21 Jun 2026, 14:32 UTC",
    );
    expect(
      screen.getByTestId("risk-council-reterm-chip-timelock"),
    ).toHaveTextContent("24h timelock");
    expect(
      screen.getByTestId("risk-council-reterm-chip-guardian"),
    ).toHaveTextContent("Guardian can cancel");
    expect(
      screen.getByTestId("risk-council-reterm-chip-cannot-execute"),
    ).toHaveTextContent("Trustee cannot execute");
  });

  it("renders the REAL Current terms (loan, coupon, CCR) from the loan-book + financials", () => {
    renderRoute();
    const card = screen.getByTestId("risk-council-reterm-current");
    expect(card).toHaveTextContent("Delta Commodities — Coffee");
    // Current epoch APY 1200 bps → 12.0%.
    expect(card).toHaveTextContent("12.0%");
    // ccr_bps 11400 → 114%.
    expect(card).toHaveTextContent("114%");
  });

  it("renders the MOCK Proposed terms (no proposal backend)", () => {
    renderRoute();
    const card = screen.getByTestId("risk-council-reterm-proposed");
    expect(card).toHaveTextContent("14.5%");
    expect(card).toHaveTextContent("+45 days");
    expect(card).toHaveTextContent("weekly reporting");
    expect(card).toHaveTextContent("Watchlist");
  });

  it("renders a read-only (disabled) 'View Safe proposal' button — the Trustee cannot execute", () => {
    renderRoute();
    const btn = screen.getByTestId("risk-council-reterm-view-safe");
    expect(btn).toHaveTextContent("View Safe proposal");
    expect(btn).toBeDisabled();
    // Read-only review page: no submit/draft control like flow 10 has.
    const footer = screen.getByTestId("risk-council-reterm-footer");
    expect(
      within(footer).getByText(/only shows review, evidence, and voting status/),
    ).toBeInTheDocument();
  });

  it("falls back to the loan-book rate when no epoch coupon is on record", () => {
    mockUseLoanFinancials.mockReturnValue({
      data: { ...FINANCIALS_RESPONSE, epoch: null },
      isLoading: false,
      error: null,
      refetch: () => {},
    });
    renderRoute();
    // rate "0.120000" → 12.0%.
    expect(screen.getByTestId("risk-council-reterm-current")).toHaveTextContent(
      "12.0%",
    );
  });
});

describe("Risk Council — Off-cycle re-term route (top-level states)", () => {
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
    expect(screen.getByTestId("risk-council-reterm-loading")).toBeInTheDocument();
  });

  it("renders an error state when the loan book fails to load", () => {
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
    expect(screen.getByTestId("risk-council-reterm-error")).toHaveTextContent(
      "network error",
    );
  });

  it("renders a not-found state when the loan isn't in the book", () => {
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
    expect(
      screen.getByTestId("risk-council-reterm-not-found"),
    ).toBeInTheDocument();
  });
});
