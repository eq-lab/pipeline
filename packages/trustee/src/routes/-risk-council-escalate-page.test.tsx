/**
 * Render tests for the Risk Council "Escalate to Default" full-page route
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
        name: "Escalate to Default — Delta Commodities",
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

  it("renders the composed proposal code block with the real loan id + originator", () => {
    renderRoute();
    const code = screen.getByTestId("risk-council-escalate-proposal-code");
    expect(code).toHaveTextContent("RiskCouncilSafe.propose(");
    expect(code).toHaveTextContent("LoanRegistry.setDefault");
    expect(code).toHaveTextContent("#4471 — Delta Commodities");
  });

  it("renders the checklist and the cannot-execute note", () => {
    renderRoute();
    const checklist = screen.getByTestId("risk-council-escalate-checklist");
    expect(checklist).toHaveTextContent(
      "Blocks all loan-tied mints once executed",
    );
    expect(checklist).toHaveTextContent("24h timelock starts at submission");
    expect(checklist).toHaveTextContent(
      "GUARDIAN can cancel during the window",
    );
    expect(
      screen.getByTestId("risk-council-escalate-cannot-execute-note"),
    ).toHaveTextContent("You cannot execute this.");
  });

  it("flips Draft → Submitted (mock, local state only) on Submit, and disables re-submission", () => {
    renderRoute();
    expect(
      screen.getByTestId("risk-council-escalate-status-chip"),
    ).toHaveTextContent("Draft");
    const submit = screen.getByTestId("risk-council-escalate-submit");
    expect(submit).toHaveTextContent("Submit to Risk Council Safe");
    fireEvent.click(submit);
    expect(
      screen.getByTestId("risk-council-escalate-status-chip"),
    ).toHaveTextContent("Submitted");
    expect(submit).toBeDisabled();
    expect(submit).toHaveTextContent("Submitted to Risk Council Safe");
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
    mockUseLoanCcrHistory.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    });
    renderRoute();
    expect(screen.getByTestId("risk-council-escalate-error")).toHaveTextContent(
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
