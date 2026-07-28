/**
 * Render tests for the Risk Council "Write-down close — Default resolution"
 * route (`risk-council.writedown.$id.tsx`, issue #782, flow 12, Figma
 * `4116-13625`). Mocks `useLoanBook`; mirrors
 * `-risk-council-reterm-page.test.tsx`.
 *
 * Covers: the header + MOCK timestamp, the three chips, the Resolution summary
 * (REAL loan + principal outstanding, MOCK recovery/write-down), the Close
 * payload code block + MOCK signer voting (signed/pending), the absence of any
 * action button (read-only), and the loading / error / not-found states.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { LoanBookResponse } from "@/api/useLoanBook";

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

import { useLoanBook } from "@/api/useLoanBook";
import { Route } from "./risk-council.writedown.$id";

const mockUseLoanBook = vi.mocked(useLoanBook);

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
      principal: "3200000.000000",
      // Principal outstanding = $3,200,000, as-is (#906).
      senior_outstanding: "3200000.000000",
      original_senior_tranche: "3200000.000000",
      maturity: 1_786_838_400,
      ccr_reported_at: 0,
      spot_price: "4500",
      spot_change_7d: "-0.18",
      collateral: "2106000.000000",
      ltv: null,
      ccr_bps: 9_800,
      duration_days: 88,
      rate: "0.120000",
      protection: null,
      status: "Default",
      repaid_to_date: "0.000000",
      disbursed: true,
      days_on_watchlist: null,
      watchlist_entered_at: null,
    },
  ],
};

function ready() {
  mockUseLoanBook.mockReturnValue({
    data: LOAN_BOOK_RESPONSE,
    isLoading: false,
    error: null,
    refetch: () => {},
  });
}

beforeEach(() => {
  mockUseLoanBook.mockReset();
});

describe("Risk Council — Write-down close route (ready)", () => {
  beforeEach(ready);

  it("renders the header, MOCK timestamp, and the three chips", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { name: "Risk proposal" }),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("risk-council-writedown-timestamp"),
    ).toHaveTextContent("21 Jun 2026, 14:32 UTC");
    expect(
      screen.getByTestId("risk-council-writedown-chip-queue"),
    ).toHaveTextContent("queued · 18h remaining");
    expect(
      screen.getByTestId("risk-council-writedown-chip-safe"),
    ).toHaveTextContent("Safe proposal");
    expect(
      screen.getByTestId("risk-council-writedown-chip-guardian"),
    ).toHaveTextContent("Guardian cancel enabled");
  });

  it("renders the Resolution summary — REAL loan + principal outstanding, MOCK recovery/write-down", () => {
    renderRoute();
    const card = screen.getByTestId("risk-council-writedown-resolution");
    expect(card).toHaveTextContent("Delta Commodities — Coffee");
    // senior_outstanding "3200000.000000" as-is (#906) ⇒ $3,200,000.
    expect(card).toHaveTextContent("$3,200,000");
    // MOCK.
    expect(card).toHaveTextContent("$2,640,000");
    expect(card).toHaveTextContent("$560,000");
  });

  it("renders the Close payload code block with the MOCK closeLoan proposal", () => {
    renderRoute();
    const code = screen.getByTestId("risk-council-writedown-code");
    expect(code).toHaveTextContent("closeLoan");
    expect(code).toHaveTextContent("DELTA-COFFEE-04");
    expect(code).toHaveTextContent("OtherWriteDown");
    expect(code).toHaveTextContent("2,640,000");
    expect(code).toHaveTextContent("560,000");
  });

  it("renders the MOCK per-signer voting status (signed / pending)", () => {
    renderRoute();
    const signers = screen.getAllByTestId("risk-council-writedown-signer");
    expect(signers).toHaveLength(3);
    expect(signers[0]).toHaveTextContent("Risk Council signer 1");
    expect(signers[0]).toHaveTextContent("signed");
    expect(signers[1]).toHaveTextContent("signed");
    expect(signers[2]).toHaveTextContent("Risk Council signer 3");
    expect(signers[2]).toHaveTextContent("pending");
  });

  it("is read-only — no action button, only the audit-trail footer note", () => {
    renderRoute();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("risk-council-writedown-footer")).getByText(
        /trustee has no direct close button on this flow/,
      ),
    ).toBeInTheDocument();
  });
});

describe("Risk Council — Write-down close route (top-level states)", () => {
  it("renders a loading skeleton while the loan book is loading", () => {
    mockUseLoanBook.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: () => {},
    });
    renderRoute();
    expect(
      screen.getByTestId("risk-council-writedown-loading"),
    ).toBeInTheDocument();
  });

  it("renders an error state when the loan book fails to load", () => {
    mockUseLoanBook.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("network error"),
      refetch: () => {},
    });
    renderRoute();
    expect(screen.getByTestId("risk-council-writedown-error")).toHaveTextContent(
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
    renderRoute();
    expect(
      screen.getByTestId("risk-council-writedown-not-found"),
    ).toBeInTheDocument();
  });
});
