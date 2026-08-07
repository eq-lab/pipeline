/**
 * Render tests for the Risk Council "Escalate" proposal-builder route
 * (`risk-council.escalate.$id.tsx`, issue #782, Figma node `4116-12953`).
 *
 * Mocks the raw API hooks (`useLoanBook`, `useLoanFinancials`,
 * `useLoanCcrHistory`) rather than the presenter — mirrors
 * `-record-coupon-page.test.tsx`'s convention (raw hooks mocked, real
 * presenter + route rendered) so the registry ×1000 scaling and the
 * real-vs-mock composition are exercised end-to-end. `Link` and
 * `Route.useParams` are patched, mirroring `-loans.$id.test.tsx`.
 *
 * Covers: the header (back link, title with the real originator, timelock
 * chip, Draft status chip), the real ledger rows (facility/senior deployed,
 * repaid to date, collateral label+value, CCR + next-alert), the MOCK
 * "Days on watchlist" tile, the CCR-trend chart, the portfolio-impact row
 * (real current % + MOCK projection, concentration), the composed proposal
 * code block with the real loan id + originator, the checklist, the
 * "cannot execute" note, the mock Submit → Draft/Submitted flip, and the
 * loading / error / not-found states.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LoanBookResponse } from "@/api/useLoanBook";
import type { LoanFinancialsResponse } from "@/api/useLoanFinancials";
import type { CcrHistoryResponse } from "@/api/useLoanCcrHistory";

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
vi.mock("@/api/useLoanCcrHistory", () => ({ useLoanCcrHistory: vi.fn() }));

import { useLoanBook } from "@/api/useLoanBook";
import { useLoanFinancials } from "@/api/useLoanFinancials";
import { useLoanCcrHistory } from "@/api/useLoanCcrHistory";
import { Route } from "./risk-council.escalate.$id";

const mockUseLoanBook = vi.mocked(useLoanBook);
const mockUseLoanFinancials = vi.mocked(useLoanFinancials);
const mockUseLoanCcrHistory = vi.mocked(useLoanCcrHistory);

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
    // Real current at-risk % (2.1%).
    at_risk_wl_and_default_pct: "0.0210",
    top_concentration: { commodity: "Coffee", share: "0.0390" },
  },
  loans: [
    {
      loan_id: "4471",
      chain_id: 99_000_001,
      originator: "Delta Commodities",
      borrower: "b1",
      commodity: "Coffee",
      // Served display-scale (#906): $2,300,000 / $1,840,000 as-is.
      principal: "2300000.000000",
      senior_outstanding: "1840000.000000",
      original_senior_tranche: "1840000.000000",
      maturity: 1_782_777_600,
      next_payment_timestamp: 1_782_777_600,
      days_overdue: null,
      ccr_reported_at: 0,
      spot_price: "4500",
      spot_change_7d: "-0.18",
      // Served display-scale (#906): $2,106,000 as-is.
      collateral: "2106000.000000",
      ltv: null,
      // 114% — between the 110% margin-call and 120% maintenance-margin bands.
      ccr_bps: 11_400,
      duration_days: 88,
      rate: "0.130000",
      protection: null,
      status: "WatchList",
      documents: [],
      repaid_to_date: "0.000000",
      disbursed: true,
      days_on_watchlist: null,
      watchlist_entered_at: null,
    },
  ],
};

const FINANCIALS_RESPONSE: LoanFinancialsResponse = {
  loan_id: "4471",
  status: "WatchList",
  location: null,
  epoch: null,
  offtaker: "2000000.000000",
  principal: "1800000.000000",
  interest: "40.000000",
  fees: "5.000000",
  minted_yield: "0.000000",
  not_minted_yield: "45.000000",
  // Nothing repaid yet ⇒ offtaker − offtaker_outstanding = $0.
  offtaker_outstanding: "2000000.000000",
};

const CCR_HISTORY_RESPONSE: CcrHistoryResponse = {
  loan_id: "4471",
  chain_id: 99_000_001,
  from: "2026-05-01T00:00:00Z",
  to: "2026-06-20T00:00:00Z",
  step_seconds: 86_400,
  points: [
    { timestamp: "2026-05-01T00:00:00Z", ccr_bps: 14_600 },
    { timestamp: "2026-06-20T00:00:00Z", ccr_bps: 11_400 },
  ],
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
  mockUseLoanCcrHistory.mockReturnValue({
    data: CCR_HISTORY_RESPONSE,
    isLoading: false,
    error: null,
  });
}

beforeEach(() => {
  mockUseLoanBook.mockReset();
  mockUseLoanFinancials.mockReset();
  mockUseLoanCcrHistory.mockReset();
});

describe("Risk Council Escalate route — ready state", () => {
  beforeEach(ready);

  it("renders the back link, title with the real originator, and the timelock + Draft chips", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", {
        name: "Escalate to Risk Council — Delta Commodities",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("‹ Risk Council").closest("a")).toHaveAttribute(
      "href",
      "/risk-council",
    );
    expect(
      screen.getByTestId("risk-council-escalate-timelock-chip"),
    ).toHaveTextContent("Risk Council Safe · 24h timelock");
    expect(
      screen.getByTestId("risk-council-escalate-status-chip"),
    ).toHaveTextContent("Draft");
  });

  it("renders the real Facility / senior deployed row (registry ×1000)", () => {
    renderRoute();
    expect(
      screen.getByTestId("risk-council-escalate-facility"),
    ).toHaveTextContent("$2,300,000 / $1,840,000");
  });

  it("renders the real Repaid to date row", () => {
    renderRoute();
    expect(
      screen.getByTestId("risk-council-escalate-repaid"),
    ).toHaveTextContent("$0");
  });

  it("renders the real Collateral label (7d, never a fabricated 30d) and value", () => {
    renderRoute();
    const row = screen.getByTestId("risk-council-escalate-collateral");
    expect(row).toHaveTextContent("Collateral (coffee −18% 7d)");
    expect(row).toHaveTextContent("$2,106,000");
  });

  it("renders the real CCR line with the next-alert clause", () => {
    renderRoute();
    expect(screen.getByTestId("risk-council-escalate-ccr")).toHaveTextContent(
      "114% — next alert at 110%",
    );
  });

  it("renders the MOCK Days-on-watchlist tile", () => {
    renderRoute();
    expect(
      screen.getByTestId("risk-council-escalate-days-on-watchlist"),
    ).toHaveTextContent("18");
  });

  it("renders the CCR-trend chart from the real ccr-history series", () => {
    renderRoute();
    const chart = screen.getByTestId("risk-council-escalate-ccr-trend");
    expect(chart).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /CCR trend, currently 114%/ }),
    ).toBeInTheDocument();
  });

  it("renders the real current at-risk % with the MOCK if-defaulted projection", () => {
    renderRoute();
    const row = screen.getByTestId("risk-council-escalate-at-risk");
    expect(row).toHaveTextContent("2.1%");
    expect(row).toHaveTextContent("4.3%");
    expect(row).toHaveTextContent("of deployed");
  });

  it("renders the concentration row when the top concentration names this loan's commodity", () => {
    renderRoute();
    const row = screen.getByTestId("risk-council-escalate-concentration");
    expect(row).toHaveTextContent("Coffee concentration");
    expect(row).toHaveTextContent("3.9%");
  });

  it("renders — for concentration when the top concentration names a different commodity", () => {
    mockUseLoanBook.mockReturnValue({
      data: {
        ...LOAN_BOOK_RESPONSE,
        summary: {
          ...LOAN_BOOK_RESPONSE.summary,
          top_concentration: { commodity: "Lithium", share: "0.0500" },
        },
      },
      isLoading: false,
      error: null,
      refetch: () => {},
    });
    renderRoute();
    expect(
      screen.getByTestId("risk-council-escalate-concentration"),
    ).toHaveTextContent("—");
  });

  it("renders the proposal builder — free-form name + text inputs (not a fixed setDefault payload)", () => {
    renderRoute();
    expect(
      screen.getByTestId("risk-council-escalate-name"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("risk-council-escalate-text"),
    ).toBeInTheDocument();
    // The old fixed setDefault code block is gone (proposal-builder model).
    expect(
      screen.queryByTestId("risk-council-escalate-proposal-code"),
    ).not.toBeInTheDocument();
  });

  it("renders the guardrail list (no 'cannot execute' block)", () => {
    renderRoute();
    const checklist = screen.getByTestId("risk-council-escalate-checklist");
    expect(checklist).toHaveTextContent("Goes to the 3-of-5 RISK_COUNCIL Safe");
    expect(checklist).toHaveTextContent("24h timelock starts at submission");
    expect(checklist).toHaveTextContent(
      "GUARDIAN can cancel during the window",
    );
    expect(
      screen.queryByTestId("risk-council-escalate-cannot-execute-note"),
    ).not.toBeInTheDocument();
  });

  it("gates Submit until name + text are filled, then flips Draft → Submitted (mock, local state)", () => {
    renderRoute();
    expect(
      screen.getByTestId("risk-council-escalate-status-chip"),
    ).toHaveTextContent("Draft");
    const submit = screen.getByTestId("risk-council-escalate-submit");
    expect(submit).toHaveTextContent("Escalate to council");
    // Disabled until BOTH fields have content.
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByTestId("risk-council-escalate-name"), {
      target: { value: "Escalate to Default — recovery exhausted" },
    });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByTestId("risk-council-escalate-text"), {
      target: { value: "Collateral gone, no recovery path; move to Default." },
    });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(
      screen.getByTestId("risk-council-escalate-status-chip"),
    ).toHaveTextContent("Submitted");
    expect(submit).toBeDisabled();
    expect(submit).toHaveTextContent("Submitted · 24h timelock");
  });
});

describe("Risk Council Escalate route — top-level states", () => {
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
    mockUseLoanCcrHistory.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });
    renderRoute();
    expect(
      screen.getByTestId("risk-council-escalate-loading"),
    ).toBeInTheDocument();
  });

  it("renders the friendly loan-load error, not the raw backend text — raw only reachable via View details (#1037)", async () => {
    const user = userEvent.setup();
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
    mockUseLoanCcrHistory.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    });
    renderRoute();
    const alert = screen.getByTestId("risk-council-escalate-error");
    expect(alert).toHaveTextContent("Failed to load the loan.");
    expect(alert).not.toHaveTextContent("network error");

    await user.click(screen.getByTestId("inline-error-view-details"));
    expect(screen.getByTestId("error-details-raw")).toHaveTextContent(
      "network error",
    );
  });

  it("renders a not-found state with a back link to /risk-council when the loan isn't in the book", () => {
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
    mockUseLoanCcrHistory.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    });
    renderRoute();
    expect(
      screen.getByTestId("risk-council-escalate-not-found"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to Risk Council" }),
    ).toHaveAttribute("href", "/risk-council");
  });
});
