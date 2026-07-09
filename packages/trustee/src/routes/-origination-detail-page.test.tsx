/**
 * Tests for the Origination details / review route component
 * (`origination.$loanId.tsx`, issue #816). Mocks `useOriginationDetail` (the
 * view-model hook) so the view is exercised as a pure render function, per
 * `docs/FRONTEND.md` rule 2. Also mocks `useLocation`/`useParams` from
 * `@tanstack/react-router` since the route isn't mounted in a real router
 * tree for these unit tests.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type {
  OriginationDetailResult,
  ValuationDisplay,
} from "./-origination-detail";

const mockUseParams = vi.fn(() => ({ loanId: "7" }));
const mockUseLocation = vi.fn(() => ({ state: undefined }));

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
    "@tanstack/react-router",
  );
  return {
    ...actual,
    useLocation: () => mockUseLocation(),
    Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  };
});

vi.mock("./-origination-detail", async () => {
  const actual = await vi.importActual<typeof import("./-origination-detail")>(
    "./-origination-detail",
  );
  return {
    ...actual,
    useOriginationDetail: vi.fn(),
  };
});

import { Route } from "./origination.$loanId";
import { useOriginationDetail } from "./-origination-detail";

// `Route.useParams` is the file-route-bound accessor the component calls;
// patch it directly since we aren't mounting a real router tree.
(Route as unknown as { useParams: () => { loanId: string } }).useParams =
  mockUseParams;

function mockDetail(result: OriginationDetailResult) {
  vi.mocked(useOriginationDetail).mockReturnValue(result);
}

function renderRoute() {
  const Page = Route.options.component as React.ComponentType;
  return render(<Page />);
}

const EMPTY_VALUATION: ValuationDisplay = {
  hasData: false,
  modeLabel: null,
  inputRows: [],
  waterfallRows: [],
  ccrLabel: null,
  initialCcrLabel: null,
  freshnessLabel: null,
};

const READY_RESULT: OriginationDetailResult = {
  state: "ready",
  heading: "Auric Andes — Gold Pyrite Concentrate",
  breadcrumb: "Auric Andes — Gold Pyrite Concentrate",
  statusChip: { kind: "in-review", label: "Awaiting your review" },
  loanTerms: {
    facility: "$3,500,000",
    senior: "$2,800,000",
    equity: "$700,000",
    offtakerPrice: "$3,750,000",
    rate: "14.0% p.a.",
    startDate: "10 Jul 2026",
    maturityDate: "15 Dec 2026",
  },
  dealDetails: {
    originator: "Auric Andes S.A.C.",
    commodity: "Gold pyrite concentrate",
    corridor: "Peru → China",
    governingLaw: "England & Wales",
    documents: [{ name: "Offtake agreement.pdf", uri: "ipfs://doc1" }],
  },
  valuation: EMPTY_VALUATION,
};

describe("Origination details route", () => {
  it("renders without throwing", () => {
    mockDetail(READY_RESULT);
    expect(() => renderRoute()).not.toThrow();
  });

  it("renders the heading and breadcrumb from loan_data", () => {
    mockDetail(READY_RESULT);
    renderRoute();
    expect(
      screen.getByRole("heading", {
        name: "Auric Andes — Gold Pyrite Concentrate",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Auric Andes — Gold Pyrite Concentrate/),
    ).toBeInTheDocument();
  });

  it("renders the status chip", () => {
    mockDetail(READY_RESULT);
    renderRoute();
    expect(
      screen.getByTestId("origination-detail-status-chip"),
    ).toHaveTextContent("Awaiting your review");
  });

  it("renders both Loan Terms and Deal Details cards with the mapped fields", () => {
    mockDetail(READY_RESULT);
    renderRoute();
    const loanTerms = screen.getByTestId("origination-detail-loan-terms");
    expect(loanTerms.textContent).toContain("$3,500,000");
    expect(loanTerms.textContent).toContain("14.0% p.a.");

    const dealDetails = screen.getByTestId("origination-detail-deal-details");
    expect(dealDetails.textContent).toContain("Peru → China");
    expect(dealDetails.textContent).toContain("Offtake agreement.pdf");
  });

  it("does NOT render the mint-invariants or signature-verified banners (no backend source)", () => {
    mockDetail(READY_RESULT);
    renderRoute();
    expect(
      screen.queryByText(/All three mint invariants pass/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Originator signature verified/),
    ).not.toBeInTheDocument();
  });

  it("renders the valuation card's empty state (404 default) without an error alert", () => {
    mockDetail(READY_RESULT);
    renderRoute();
    expect(
      screen.getByTestId("origination-detail-valuation-empty"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByTestId("origination-detail-ccr")).toHaveTextContent("—");
  });

  it("renders the initial CCR row even while the valuation card is in its empty state", () => {
    mockDetail({
      ...READY_RESULT,
      valuation: { ...EMPTY_VALUATION, initialCcrLabel: "150%" },
    });
    renderRoute();
    expect(
      screen.getByTestId("origination-detail-initial-ccr"),
    ).toHaveTextContent("150%");
  });

  it("does not render the initial-CCR row when initial_ccr is unavailable", () => {
    mockDetail(READY_RESULT);
    renderRoute();
    expect(
      screen.queryByTestId("origination-detail-initial-ccr"),
    ).not.toBeInTheDocument();
  });

  it("renders three inert action buttons with disabled/aria-disabled", () => {
    mockDetail(READY_RESULT);
    renderRoute();
    for (const testId of [
      "origination-detail-request-changes",
      "origination-detail-reject",
      "origination-detail-approve",
    ]) {
      const button = screen.getByTestId(testId);
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("aria-disabled", "true");
    }
  });

  it("renders a loading state", () => {
    mockDetail({ ...READY_RESULT, state: "loading" });
    renderRoute();
    expect(
      screen.getByTestId("origination-detail-loading"),
    ).toBeInTheDocument();
  });

  it("renders a not-found state", () => {
    mockDetail({ ...READY_RESULT, state: "not-found" });
    renderRoute();
    expect(
      screen.getByTestId("origination-detail-not-found"),
    ).toBeInTheDocument();
  });

  it("renders the valuation-mode chip only when the valuation call succeeded", () => {
    mockDetail({
      ...READY_RESULT,
      valuation: { ...EMPTY_VALUATION, hasData: true, modeLabel: "NSR" },
    });
    renderRoute();
    expect(screen.getByText("NSR · Net Smelter Return")).toBeInTheDocument();
  });

  it("does not render a valuation-mode chip when there is no valuation yet", () => {
    mockDetail(READY_RESULT);
    renderRoute();
    expect(
      screen.queryByText(/NSR · Net Smelter Return/),
    ).not.toBeInTheDocument();
  });

  it("renders the StandardGoods branch without NSR-only rows", () => {
    mockDetail({
      ...READY_RESULT,
      valuation: {
        hasData: true,
        modeLabel: "Standard",
        inputRows: [{ label: "Reference price", value: "$100" }],
        waterfallRows: [],
        ccrLabel: "160.00%",
        initialCcrLabel: null,
        freshnessLabel: null,
      },
    });
    renderRoute();
    expect(
      screen.getByText("Collateral valuation — Standard"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("origination-detail-ccr")).toHaveTextContent(
      "160.00%",
    );
  });
});
