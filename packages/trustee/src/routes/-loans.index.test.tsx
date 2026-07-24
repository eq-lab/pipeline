/**
 * Render tests for the Trustee Loans list route (`loans.index.tsx`, issue #843).
 *
 * `useLoanBook` is mocked so the page renders against a representative response
 * without the query layer. Asserts the heading, the five summary cards, the
 * tab-bar + per-status counts, the table rows, the pre-default (`<120%`) CCR
 * band styling, `—` on null cells, the client-side tab filter, and the
 * CCR-band footnote — plus the loading / error / empty states. Row-click now
 * navigates to `/loans/$id` with the served `loan_id` (`useNavigate` mocked;
 * the #847 in-page "fake nav" is gone).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { LoanBookResponse } from "@/api/useLoanBook";

// ── Mock the router navigation ─────────────────────────────────────────────────

const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
    "@tanstack/react-router",
  );
  return { ...actual, useNavigate: () => mockNavigate };
});

// ── Mock the data hook ────────────────────────────────────────────────────────

vi.mock("@/api/useLoanBook", () => ({ useLoanBook: vi.fn() }));
import { useLoanBook } from "@/api/useLoanBook";
import { Route } from "./loans.index";
const mockUseLoanBook = vi.mocked(useLoanBook);

// ── Fixtures ──────────────────────────────────────────────────────────────────

const RESPONSE: LoanBookResponse = {
  summary: {
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
  },
  loans: [
    {
      loan_id: "4488",
      chain_id: 99_000_001,
      originator: "Delta Commodities",
      borrower: "b1",
      commodity: "Coffee",
      principal: "2000.000000",
      senior_outstanding: "1840.000000",
      original_senior_tranche: "1840.000000",
      maturity: 1_785_000_000,
      ccr_reported_at: Math.floor(Date.now() / 1000) - 3600,
      spot_price: "4500.00",
      spot_change_7d: "-0.1800",
      collateral: "2100.000000", // displayed as served (issue #906) → $2.10K
      ltv: null,
      ccr_bps: 11_400, // served as-is (#888, no ÷1000) ⇒ 114% ⇒ pre-default (<120%)
      duration_days: 180,
      rate: "0.140000",
      protection: null,
      status: "Performing",
      repaid_to_date: "0.000000",
      disbursed: true,
      days_on_watchlist: null,
      watchlist_entered_at: null,
    },
    {
      loan_id: "4489",
      chain_id: 99_000_001,
      originator: "Sahel Cocoa",
      borrower: "b2",
      commodity: "Cocoa",
      principal: "1500.000000",
      senior_outstanding: "1260.000000",
      original_senior_tranche: "1260.000000",
      maturity: 1_789_000_000,
      ccr_reported_at: 0,
      spot_price: null,
      spot_change_7d: null,
      collateral: null,
      ltv: null,
      ccr_bps: null,
      duration_days: 200,
      rate: "0.130000",
      protection: null,
      status: "WatchList",
      repaid_to_date: "0.000000",
      disbursed: true,
      days_on_watchlist: 18,
      watchlist_entered_at: 1_787_444_800,
    },
  ],
};

function renderRoute() {
  const Page = Route.options.component as React.ComponentType;
  return render(<Page />);
}

function ready(data: LoanBookResponse) {
  mockUseLoanBook.mockReturnValue({
    data,
    isLoading: false,
    error: null,
    refetch: () => {},
  });
}

beforeEach(() => {
  mockUseLoanBook.mockReset();
  mockNavigate.mockReset();
});

// ── Ready state ────────────────────────────────────────────────────────────────

describe("Loans list route (ready)", () => {
  beforeEach(() => ready(RESPONSE));

  it("renders the Loans heading", () => {
    renderRoute();
    expect(screen.getByRole("heading", { name: "Loans" })).toBeInTheDocument();
  });

  it("navigates to /loans/$id with the loan_id when a row is clicked", () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("loans-row"));
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/loans/$id",
      params: { id: "4488" },
    });
  });

  it("navigates on keyboard activation (Enter)", () => {
    renderRoute();
    fireEvent.keyDown(screen.getByTestId("loans-row"), { key: "Enter" });
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/loans/$id",
      params: { id: "4488" },
    });
  });

  it("renders the five summary cards with the Figma values", () => {
    renderRoute();
    expect(screen.getByText("$96K")).toBeInTheDocument();
    expect(screen.getByText("4.3%")).toBeInTheDocument();
    expect(screen.getByText("$4.85K")).toBeInTheDocument();
    expect(screen.getByText("13.1%")).toBeInTheDocument();
    expect(screen.getByText("148d")).toBeInTheDocument();
    expect(screen.getByText("7.2%")).toBeInTheDocument();
    expect(screen.getByText("Cocoa · limit 10%")).toBeInTheDocument();
  });

  it("renders the tab-bar with per-status counts (Default/Closed empty)", () => {
    renderRoute();
    expect(
      within(screen.getByTestId("loans-tab-Performing")).getByText("1"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("loans-tab-Watchlist")).getByText("1"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("loans-tab-Default")).getByText("0"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("loans-tab-Closed")).getByText("0"),
    ).toBeInTheDocument();
  });

  it("shows the active (Performing) row with a pre-default red CCR", () => {
    renderRoute();
    const rows = screen.getAllByTestId("loans-row");
    expect(rows).toHaveLength(1);
    expect(screen.getByText("Delta Commodities")).toBeInTheDocument();
    expect(screen.getByText("$1.84K")).toBeInTheDocument();
    const ccr = screen.getByTestId("loans-ccr");
    expect(ccr).toHaveTextContent("114%");
    expect(ccr).toHaveAttribute("data-band", "pre-default");
    expect(ccr).toHaveStyle({ color: "#b20000" });
  });

  it("filters to the Watchlist tab and renders — for the null collateral/CCR cells", () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("loans-tab-Watchlist"));
    expect(screen.getByText("Sahel Cocoa")).toBeInTheDocument();
    expect(screen.queryByText("Delta Commodities")).not.toBeInTheDocument();
    // No priced collateral and no CCR ⇒ em-dash, no CCR band chip.
    expect(screen.queryByTestId("loans-ccr")).not.toBeInTheDocument();
    const row = screen.getByTestId("loans-row");
    expect(within(row).getAllByText("—").length).toBeGreaterThan(0);
  });

  it("shows the empty message for the (backend-unpopulated) Default tab", () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("loans-tab-Default"));
    expect(screen.getByTestId("loans-empty")).toHaveTextContent(
      "No defaulted loans.",
    );
  });

  it("renders the CCR-band footnote", () => {
    renderRoute();
    const footnote = screen.getByTestId("loans-footnote");
    expect(footnote).toHaveTextContent("≥130%");
    expect(footnote).toHaveTextContent("120–130%");
    expect(footnote).toHaveTextContent("<120%");
    expect(footnote).toHaveTextContent(
      "Written on-chain only at threshold crossings.",
    );
  });

  it("does NOT render the omitted 'Record coupon' action (Open Question 3)", () => {
    renderRoute();
    expect(screen.queryByText("Record coupon")).not.toBeInTheDocument();
    expect(screen.queryByText(/Payments due/)).not.toBeInTheDocument();
  });
});

// ── Empty / loading / error ─────────────────────────────────────────────────────

describe("Loans list route (empty book)", () => {
  it("renders summary + a per-tab empty message when no loans are active", () => {
    ready({ ...RESPONSE, loans: [] });
    renderRoute();
    expect(screen.getByText("$96K")).toBeInTheDocument();
    expect(screen.getByTestId("loans-empty")).toHaveTextContent(
      "No performing loans.",
    );
  });
});

describe("Loans list route (loading)", () => {
  it("renders the skeleton", () => {
    mockUseLoanBook.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: () => {},
    });
    renderRoute();
    expect(screen.getByTestId("loans-loading")).toBeInTheDocument();
  });
});

describe("Loans list route (error)", () => {
  it("renders the error alert", () => {
    mockUseLoanBook.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("boom"),
      refetch: () => {},
    });
    renderRoute();
    expect(screen.getByTestId("loans-error")).toHaveTextContent("boom");
  });
});
