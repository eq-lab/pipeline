/**
 * Tests for the Origination details / review route component
 * (`origination.$id.tsx`, issue #821). Mocks `useOriginationDetail` (the
 * view-model hook) so the view is exercised as a pure render function, per
 * `docs/FRONTEND.md` rule 2. Also mocks `useLocation`/`Route.useParams` from
 * `@tanstack/react-router` since the route isn't mounted in a real router
 * tree for these unit tests.
 *
 * Critically asserts the ABSENCE of the collateral-valuation card / waterfall
 * / CCR / mint-invariants / signature-verified banner — the Figma's
 * valuation card is incorrect and must not exist in this component at all
 * (issue #821 supersedes the closed #816, which had it).
 *
 * Also covers the status-conditional detail footer (issue #823): InReview
 * renders the three inert action buttons (unchanged); Approved renders the
 * green "Approved & minted · <date>" banner (and NO "funded from batch"
 * text — that segment is deliberately omitted, no backing field); Rejected
 * renders the red "Rejected · <date> — <reason>" banner; both banner cases
 * assert the action buttons are ABSENT. An unknown status falls back to the
 * InReview footer.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { OriginationDetailResult } from "./-origination-detail";

const mockUseParams = vi.fn(() => ({ id: "7" }));
const mockUseLocation = vi.fn(() => ({ state: {} }));

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
    "@tanstack/react-router",
  );
  return {
    ...actual,
    useLocation: () => mockUseLocation(),
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
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

import { Route } from "./origination.$id";
import { useOriginationDetail } from "./-origination-detail";

// `Route.useParams` is the file-route-bound accessor the component calls;
// patch it directly since we aren't mounting a real router tree.
(Route as unknown as { useParams: () => { id: string } }).useParams =
  mockUseParams;

function mockDetail(result: OriginationDetailResult) {
  vi.mocked(useOriginationDetail).mockReturnValue(result);
}

function renderRoute() {
  const Page = Route.options.component as React.ComponentType;
  return render(<Page />);
}

const READY_RESULT: OriginationDetailResult = {
  state: "ready",
  heading: "Auric Andes S.A.C. — Gold pyrite concentrate",
  breadcrumb: "Auric Andes S.A.C. — Gold pyrite concentrate",
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
  statusKind: "in-review",
  reviewedDate: "2 Jan",
  rejectionReason: "—",
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
        name: "Auric Andes S.A.C. — Gold pyrite concentrate",
      }),
    ).toBeInTheDocument();
    // The breadcrumb repeats the same text in a non-heading <p> ("Origination
    // / <breadcrumb>") — both match the loose regex, so this asserts there
    // are exactly the two expected occurrences (heading + breadcrumb).
    expect(
      screen.getAllByText(/Auric Andes S.A.C. — Gold pyrite concentrate/),
    ).toHaveLength(2);
  });

  it("renders the backed status chip", () => {
    mockDetail(READY_RESULT);
    renderRoute();
    expect(
      screen.getByTestId("origination-detail-status-chip"),
    ).toHaveTextContent("Awaiting your review");
  });

  it("renders the Loan Terms card's seven rows", () => {
    mockDetail(READY_RESULT);
    renderRoute();
    const loanTerms = screen.getByTestId("origination-detail-loan-terms");
    expect(loanTerms.textContent).toContain("Facility size");
    expect(loanTerms.textContent).toContain("$3,500,000");
    expect(loanTerms.textContent).toContain("Senior tranche");
    expect(loanTerms.textContent).toContain("$2,800,000");
    expect(loanTerms.textContent).toContain("Equity tranche");
    expect(loanTerms.textContent).toContain("$700,000");
    expect(loanTerms.textContent).toContain("Offtaker price");
    expect(loanTerms.textContent).toContain("$3,750,000");
    expect(loanTerms.textContent).toContain("Rate");
    expect(loanTerms.textContent).toContain("14.0% p.a.");
    expect(loanTerms.textContent).toContain("Start date");
    expect(loanTerms.textContent).toContain("10 Jul 2026");
    expect(loanTerms.textContent).toContain("Maturity date");
    expect(loanTerms.textContent).toContain("15 Dec 2026");
  });

  it("renders the Deal Details card's four rows plus the documents list", () => {
    mockDetail(READY_RESULT);
    renderRoute();
    const dealDetails = screen.getByTestId("origination-detail-deal-details");
    expect(dealDetails.textContent).toContain("Originator");
    expect(dealDetails.textContent).toContain("Auric Andes S.A.C.");
    expect(dealDetails.textContent).toContain("Commodity");
    expect(dealDetails.textContent).toContain("Gold pyrite concentrate");
    expect(dealDetails.textContent).toContain("Corridor");
    expect(dealDetails.textContent).toContain("Peru → China");
    expect(dealDetails.textContent).toContain("Governing law");
    expect(dealDetails.textContent).toContain("England & Wales");
    expect(dealDetails.textContent).toContain("Offtake agreement.pdf");
  });

  it("renders the empty-documents state as 'No documents provided.'", () => {
    mockDetail({
      ...READY_RESULT,
      dealDetails: { ...READY_RESULT.dealDetails, documents: [] },
    });
    renderRoute();
    expect(screen.getByText("No documents provided.")).toBeInTheDocument();
  });

  it("renders a loading state", () => {
    mockDetail({ ...READY_RESULT, state: "loading" });
    renderRoute();
    expect(
      screen.getByTestId("origination-detail-loading"),
    ).toBeInTheDocument();
  });

  it("renders a not-found state with a back-Link to /origination", () => {
    mockDetail({ ...READY_RESULT, state: "not-found" });
    renderRoute();
    const notFound = screen.getByTestId("origination-detail-not-found");
    expect(notFound).toBeInTheDocument();
    const backLink = screen.getByRole("link", { name: "Back to Origination" });
    expect(backLink).toHaveAttribute("href", "/origination");
  });

  // ── NO collateral-valuation UI — the Figma's valuation card is incorrect ──

  it("does NOT render any collateral-valuation card, waterfall, CCR, or freshness chip", () => {
    mockDetail(READY_RESULT);
    renderRoute();
    expect(
      screen.queryByTestId("origination-detail-valuation"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("origination-detail-valuation-inputs"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("origination-detail-valuation-waterfall"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("origination-detail-ccr"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("origination-detail-initial-ccr"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("origination-detail-freshness-chip"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Collateral valuation/)).not.toBeInTheDocument();
    expect(screen.queryByText(/NSR waterfall/)).not.toBeInTheDocument();
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

  it("does NOT render the static 'Your key · one click' chip or the NSR valuation-mode chip", () => {
    mockDetail(READY_RESULT);
    renderRoute();
    expect(screen.queryByText("Your key · one click")).not.toBeInTheDocument();
    expect(
      screen.queryByText("NSR · Net Smelter Return"),
    ).not.toBeInTheDocument();
  });

  it("renders only ONE chip (the status chip) in the chip row", () => {
    mockDetail(READY_RESULT);
    renderRoute();
    expect(
      screen.getAllByTestId("origination-detail-status-chip"),
    ).toHaveLength(1);
  });

  // ── Status-conditional detail footer (issue #823) ─────────────────────────

  describe("status-conditional footer", () => {
    it("InReview: renders the three inert action buttons; NO banner", () => {
      mockDetail(READY_RESULT); // statusKind: "in-review"
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
      expect(
        screen.queryByTestId("origination-detail-approved-banner"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("origination-detail-rejected-banner"),
      ).not.toBeInTheDocument();
    });

    it("Approved: renders the green 'Approved & minted · <date>' banner; NO action buttons; NO fabricated batch text", () => {
      mockDetail({
        ...READY_RESULT,
        statusChip: { kind: "approved", label: "Approved" },
        statusKind: "approved",
        reviewedDate: "2 Jan",
      });
      renderRoute();
      const banner = screen.getByTestId("origination-detail-approved-banner");
      expect(banner).toHaveTextContent("Approved & minted · 2 Jan");
      expect(screen.queryByText(/funded from batch/)).not.toBeInTheDocument();
      expect(screen.queryByText(/#B-102/)).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("origination-detail-request-changes"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("origination-detail-reject"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("origination-detail-approve"),
      ).not.toBeInTheDocument();
    });

    it("Rejected: renders the red 'Rejected · <date> — <reason>' banner; NO action buttons", () => {
      mockDetail({
        ...READY_RESULT,
        statusChip: { kind: "rejected", label: "Rejected" },
        statusKind: "rejected",
        reviewedDate: "5 May",
        rejectionReason: "Missing export permit",
      });
      renderRoute();
      const banner = screen.getByTestId("origination-detail-rejected-banner");
      expect(banner).toHaveTextContent(
        "Rejected · 5 May — Missing export permit",
      );
      expect(
        screen.queryByTestId("origination-detail-request-changes"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("origination-detail-reject"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("origination-detail-approve"),
      ).not.toBeInTheDocument();
    });

    it("unknown status: falls back to the InReview action-buttons footer", () => {
      mockDetail({
        ...READY_RESULT,
        statusChip: { kind: "unknown", label: "—" },
        statusKind: "unknown",
      });
      renderRoute();
      expect(
        screen.getByTestId("origination-detail-request-changes"),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("origination-detail-approved-banner"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("origination-detail-rejected-banner"),
      ).not.toBeInTheDocument();
    });
  });
});
