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
 * Also covers the status-conditional detail footer (issue #823, copy
 * amended by #829, restored by #831): InReview renders the Reject/Approve
 * action buttons (WIRED — issue #829, chain-first mint added by #831,
 * gated behind a confirmation dialog by #838); Approved renders the green
 * "Approved & minted · <date>" banner (restored — #829 dropped "& minted"
 * pending the real mint, #831 shipped it) and NO "funded from batch" text —
 * that segment is deliberately omitted, no backing field; Rejected renders
 * the red "Rejected · <date> — <reason>" banner; both banner cases assert
 * the action buttons are ABSENT. Backend merged/lifecycle statuses normalize
 * to Approved in the presenter (#892). The inert "Request changes" button
 * #838 removed is back as a WIRED control (#1017): it opens the
 * `RequestChangesDialog` (`review.openRequestChanges`), whose Cancel/Submit
 * call the mocked `cancelRequestChanges`/`submitRequestChanges`.
 *
 * Approve/Reject wiring (issue #829, extended by #831, gated behind
 * confirmation dialogs by #838): `useOriginationReview` is mocked (like
 * `useOriginationDetail`) so these are pure render-layer tests — clicking
 * Approve OPENS the `ApproveMintDialog` (`review.openApprove`), clicking
 * Reject opens `RejectReasonDialog` (`review.openReject`); pending disables
 * both page-level buttons; the mapped error renders inline near the buttons
 * only when NEITHER dialog is open, otherwise inside whichever dialog is
 * open. Neither dialog component is mocked — `RejectReasonDialog`'s own
 * behavior is covered by `-RejectReasonDialog.test.tsx` and
 * `ApproveMintDialog`'s by `-ApproveMintDialog.test.tsx`; here both are
 * exercised as real integration points (Cancel/Confirm/Submit call the
 * mocked `cancelApprove`/`approve`/`cancelReject`/`submitReject`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OriginationDetailResult } from "./-origination-detail";
import type { UseOriginationReviewResult } from "./-useOriginationReview";

const mockUseParams = vi.fn(() => ({ id: "7" }));
const mockUseLocation = vi.fn(() => ({ state: {} }));

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
    "@tanstack/react-router",
  );
  return {
    ...actual,
    useLocation: () => mockUseLocation(),
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
      // Interpolate `$id`-style route params so `href` matches the resolved path.
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

vi.mock("./-origination-detail", async () => {
  const actual = await vi.importActual<typeof import("./-origination-detail")>(
    "./-origination-detail",
  );
  return {
    ...actual,
    useOriginationDetail: vi.fn(),
  };
});

const mockUseOriginationReview = vi.fn<() => UseOriginationReviewResult>();
vi.mock("./-useOriginationReview", () => ({
  useOriginationReview: () => mockUseOriginationReview(),
}));

import { Route } from "./origination.$id";
import { useOriginationDetail } from "./-origination-detail";

// `Route.useParams` is the file-route-bound accessor the component calls;
// patch it directly since we aren't mounting a real router tree.
(Route as unknown as { useParams: () => { id: string } }).useParams =
  mockUseParams;

function mockDetail(result: OriginationDetailResult) {
  vi.mocked(useOriginationDetail).mockReturnValue(result);
}

function mockReview(overrides?: Partial<UseOriginationReviewResult>) {
  mockUseOriginationReview.mockReturnValue({
    approve: vi.fn(),
    openApprove: vi.fn(),
    cancelApprove: vi.fn(),
    openReject: vi.fn(),
    cancelReject: vi.fn(),
    submitReject: vi.fn(),
    openRequestChanges: vi.fn(),
    cancelRequestChanges: vi.fn(),
    submitRequestChanges: vi.fn(),
    isPending: false,
    mintingLabel: null,
    errorMessage: null,
    errorDetails: null,
    approveOpen: false,
    rejectOpen: false,
    requestChangesOpen: false,
    mintedLoanId: null,
    ...overrides,
  });
}

beforeEach(() => {
  mockReview();
});

function renderRoute() {
  const Page = Route.options.component as React.ComponentType;
  return render(<Page />);
}

const READY_RESULT: OriginationDetailResult = {
  state: "ready",
  errorMessage: null,
  errorDetails: null,
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
    protection: "LC at sight",
    location: "Warehouse — SGS bonded stockpile, Callao, Peru",
    documents: [{ name: "Offtake agreement.pdf", uri: "ipfs://doc1" }],
  },
  statusKind: "in-review",
  reviewedDate: "2 Jan",
  rejectionReason: "—",
  transactionPreview: {
    keyword: "LoanRegistry.mintLoan",
    rows: [
      { label: "originator", value: "Auric Andes S.A.C." },
      { label: "economics", value: "{ facility $3,500,000 }" },
      { label: "metadataURI", value: "ipfs://auric-assay-offtake-hash" },
      { label: "initialLocation", value: "MV Example" },
    ],
  },
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

  it("renders the Deal Details card's six rows plus the documents list", () => {
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
    expect(dealDetails.textContent).toContain("Protection");
    expect(dealDetails.textContent).toContain("LC at sight");
    expect(dealDetails.textContent).toContain("Location");
    // #1014: the location TYPE leads the value under the fixed "Location" label.
    expect(dealDetails.textContent).toContain(
      "Warehouse — SGS bonded stockpile, Callao, Peru",
    );
    expect(dealDetails.textContent).toContain("Offtake agreement.pdf");
    // #1014: the two new rows sit directly after Governing law.
    expect(dealDetails.textContent!.indexOf("Governing law")).toBeLessThan(
      dealDetails.textContent!.indexOf("Protection"),
    );
    expect(dealDetails.textContent!.indexOf("Protection")).toBeLessThan(
      dealDetails.textContent!.indexOf("Location"),
    );
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

  it("renders a distinct error state — NOT the not-found copy — when the submissions fetch failed (#1065)", () => {
    mockDetail({
      ...READY_RESULT,
      state: "error",
      errorMessage: "Failed to load the submission.",
      errorDetails: "fetch failed: 500",
    });
    renderRoute();
    const error = screen.getByTestId("origination-detail-error");
    expect(error).toHaveTextContent("Failed to load the submission.");
    expect(error).not.toHaveTextContent("fetch failed: 500");
    expect(
      screen.queryByTestId("origination-detail-not-found"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "‹ Origination" })).toHaveAttribute(
      "href",
      "/origination",
    );
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
    it("InReview: Reject/Request changes/Approve are enabled (#1017); NO banner", () => {
      mockDetail(READY_RESULT); // statusKind: "in-review"
      renderRoute();

      const rejectButton = screen.getByTestId("origination-detail-reject");
      const requestChangesButton = screen.getByTestId(
        "origination-detail-request-changes",
      );
      const approveButton = screen.getByTestId("origination-detail-approve");
      expect(rejectButton).not.toBeDisabled();
      expect(requestChangesButton).not.toBeDisabled();
      expect(requestChangesButton).toHaveTextContent("Request changes");
      expect(approveButton).not.toBeDisabled();
      expect(approveButton).toHaveTextContent("Approve");

      expect(
        screen.queryByTestId("origination-detail-approved-banner"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("origination-detail-rejected-banner"),
      ).not.toBeInTheDocument();
    });

    it("does NOT render the removed footer note about minting/disbursement", () => {
      mockDetail(READY_RESULT);
      renderRoute();
      expect(
        screen.queryByText(/Approval mints the loan NFT/),
      ).not.toBeInTheDocument();
    });

    it("Approved: renders the green 'Approved & drawn · <date>' banner (#831/#876); NO action buttons; NO fabricated batch text", () => {
      mockDetail({
        ...READY_RESULT,
        statusChip: { kind: "approved", label: "Approved" },
        statusKind: "approved",
        reviewedDate: "2 Jan",
      });
      renderRoute();
      const banner = screen.getByTestId("origination-detail-approved-banner");
      expect(banner).toHaveTextContent("Approved & drawn · 2 Jan");
      expect(screen.queryByText(/funded from batch/)).not.toBeInTheDocument();
      expect(screen.queryByText(/#B-102/)).not.toBeInTheDocument();
      // No minted loan id in this session → no deep-link (#876).
      expect(
        screen.queryByTestId("origination-detail-view-loan-link"),
      ).not.toBeInTheDocument();
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

    it("Approved: shows a 'View loan' deep-link when the drawn loan id is known (#876)", () => {
      mockDetail({
        ...READY_RESULT,
        statusChip: { kind: "approved", label: "Approved" },
        statusKind: "approved",
        reviewedDate: "2 Jan",
      });
      mockReview({ mintedLoanId: 4488 });
      renderRoute();
      const link = screen.getByTestId("origination-detail-view-loan-link");
      expect(link).toHaveTextContent("View loan #4488");
      expect(link).toHaveAttribute("href", "/loans/4488");
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

    it("ChangesRequested: renders the amber 'Changes requested · <date> — <reason>' banner; NO action buttons (#950)", () => {
      mockDetail({
        ...READY_RESULT,
        statusChip: { kind: "changes-requested", label: "Changes requested" },
        statusKind: "changes-requested",
        reviewedDate: "6 May",
        rejectionReason: "Attach the amended offtake agreement",
      });
      renderRoute();
      const banner = screen.getByTestId(
        "origination-detail-changes-requested-banner",
      );
      expect(banner).toHaveTextContent(
        "Changes requested · 6 May — Attach the amended offtake agreement",
      );
      // Non-final, waiting on the originator → no trustee action buttons.
      expect(
        screen.queryByTestId("origination-detail-reject"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("origination-detail-approve"),
      ).not.toBeInTheDocument();
    });

    it("backend lifecycle status: renders the Approved banner, not action buttons (#892)", () => {
      mockDetail({
        ...READY_RESULT,
        statusChip: { kind: "approved", label: "Approved" },
        statusKind: "approved",
        reviewedDate: "2 Jan",
      });
      renderRoute();
      expect(
        screen.getByTestId("origination-detail-approved-banner"),
      ).toHaveTextContent("Approved & drawn · 2 Jan");
      expect(
        screen.queryByTestId("origination-detail-reject"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("origination-detail-approve"),
      ).not.toBeInTheDocument();
    });
  });

  // ── Approve/Reject wiring (issue #829) ─────────────────────────────────────

  describe("Approve/Reject wiring", () => {
    it("clicking Approve calls review.openApprove() (issue #838 — opens the confirm dialog, does not mint directly)", () => {
      const openApprove = vi.fn();
      const approve = vi.fn();
      mockReview({ openApprove, approve });
      mockDetail(READY_RESULT);
      renderRoute();

      fireEvent.click(screen.getByTestId("origination-detail-approve"));
      expect(openApprove).toHaveBeenCalledTimes(1);
      expect(approve).not.toHaveBeenCalled();
    });

    it("clicking Reject calls review.openReject()", () => {
      const openReject = vi.fn();
      mockReview({ openReject });
      mockDetail(READY_RESULT);
      renderRoute();

      fireEvent.click(screen.getByTestId("origination-detail-reject"));
      expect(openReject).toHaveBeenCalledTimes(1);
    });

    it("clicking Request changes calls review.openRequestChanges() (#1017)", () => {
      const openRequestChanges = vi.fn();
      mockReview({ openRequestChanges });
      mockDetail(READY_RESULT);
      renderRoute();

      fireEvent.click(screen.getByTestId("origination-detail-request-changes"));
      expect(openRequestChanges).toHaveBeenCalledTimes(1);
    });

    it("disables Reject/Request changes/Approve while isPending", () => {
      mockReview({ isPending: true });
      mockDetail(READY_RESULT);
      renderRoute();

      expect(screen.getByTestId("origination-detail-reject")).toBeDisabled();
      expect(
        screen.getByTestId("origination-detail-request-changes"),
      ).toBeDisabled();
      expect(screen.getByTestId("origination-detail-approve")).toBeDisabled();
    });

    it("renders the mapped error inline near the buttons when set and both dialogs are closed", () => {
      mockReview({
        errorMessage: "You are not authorized to review submissions.",
        approveOpen: false,
        rejectOpen: false,
      });
      mockDetail(READY_RESULT);
      renderRoute();

      expect(
        screen.getByTestId("origination-detail-review-error"),
      ).toHaveTextContent("You are not authorized to review submissions.");
    });

    it("wires errorDetails through to InlineError's View details trigger (#1037)", async () => {
      const user = userEvent.setup();
      mockReview({
        errorMessage: "Something went wrong. Please try again.",
        errorDetails: "raw backend diagnostic text",
      });
      mockDetail(READY_RESULT);
      renderRoute();

      await user.click(screen.getByTestId("inline-error-view-details"));
      expect(screen.getByTestId("error-details-raw")).toHaveTextContent(
        "raw backend diagnostic text",
      );
    });

    it("does NOT render the inline error while the reject dialog is open (the dialog owns it)", () => {
      mockReview({
        errorMessage: "This submission has already been reviewed.",
        rejectOpen: true,
      });
      mockDetail(READY_RESULT);
      renderRoute();

      expect(
        screen.queryByTestId("origination-detail-review-error"),
      ).not.toBeInTheDocument();
      // ...it renders inside the dialog instead.
      expect(screen.getByTestId("reject-reason-error")).toHaveTextContent(
        "This submission has already been reviewed.",
      );
    });

    it("does NOT render the inline error while the approve dialog is open (the dialog owns it)", () => {
      mockReview({
        errorMessage: "Signature cancelled. Click Approve again to retry.",
        approveOpen: true,
      });
      mockDetail(READY_RESULT);
      renderRoute();

      expect(
        screen.queryByTestId("origination-detail-review-error"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("approve-mint-error")).toHaveTextContent(
        "Signature cancelled. Click Approve again to retry.",
      );
    });

    it("does NOT render the inline error while the request-changes dialog is open (the dialog owns it, #1017)", () => {
      mockReview({
        errorMessage: "This submission has already been reviewed.",
        requestChangesOpen: true,
      });
      mockDetail(READY_RESULT);
      renderRoute();

      expect(
        screen.queryByTestId("origination-detail-review-error"),
      ).not.toBeInTheDocument();
      // ...it renders inside the dialog instead.
      expect(screen.getByTestId("request-changes-error")).toHaveTextContent(
        "This submission has already been reviewed.",
      );
    });

    it("renders the RequestChangesDialog when requestChangesOpen is true, and NOT when false (#1017)", () => {
      mockReview({ requestChangesOpen: false });
      mockDetail(READY_RESULT);
      const { unmount } = renderRoute();
      expect(
        screen.queryByTestId("request-changes-dialog"),
      ).not.toBeInTheDocument();
      unmount();

      mockReview({ requestChangesOpen: true });
      renderRoute();
      expect(screen.getByTestId("request-changes-dialog")).toBeInTheDocument();
      // The originator flows through to the dialog title.
      expect(
        screen.getByRole("heading", {
          name: "Request changes — Auric Andes S.A.C.",
        }),
      ).toBeInTheDocument();
    });

    it("Cancel/Submit in the request-changes dialog call the review handlers (#1017)", () => {
      const cancelRequestChanges = vi.fn();
      const submitRequestChanges = vi.fn();
      mockReview({
        requestChangesOpen: true,
        cancelRequestChanges,
        submitRequestChanges,
      });
      mockDetail(READY_RESULT);
      renderRoute();

      fireEvent.change(screen.getByTestId("request-changes-input"), {
        target: { value: "  Assay certificate incomplete  " },
      });
      fireEvent.click(screen.getByTestId("request-changes-submit"));
      expect(submitRequestChanges).toHaveBeenCalledWith(
        "Assay certificate incomplete",
      );

      fireEvent.click(screen.getByTestId("request-changes-cancel"));
      expect(cancelRequestChanges).toHaveBeenCalledTimes(1);
    });

    it("renders the RejectReasonDialog when rejectOpen is true, and NOT when false", () => {
      mockReview({ rejectOpen: false });
      mockDetail(READY_RESULT);
      const { rerender } = renderRoute();
      expect(
        screen.queryByTestId("reject-reason-dialog"),
      ).not.toBeInTheDocument();

      mockReview({ rejectOpen: true });
      const Page = Route.options.component as React.ComponentType;
      rerender(<Page />);
      expect(screen.getByTestId("reject-reason-dialog")).toBeInTheDocument();
    });

    it("passes the originator through to the RejectReasonDialog's title", () => {
      mockReview({ rejectOpen: true });
      mockDetail(READY_RESULT);
      renderRoute();
      expect(
        screen.getByRole("heading", {
          name: `Reject request — ${READY_RESULT.dealDetails.originator}`,
        }),
      ).toBeInTheDocument();
    });

    it("Cancel in the reject dialog calls review.cancelReject()", () => {
      const cancelReject = vi.fn();
      mockReview({ rejectOpen: true, cancelReject });
      mockDetail(READY_RESULT);
      renderRoute();

      fireEvent.click(screen.getByTestId("reject-reason-cancel"));
      expect(cancelReject).toHaveBeenCalledTimes(1);
    });

    it("Submit in the reject dialog calls review.submitReject(reason) with the trimmed reason", () => {
      const submitReject = vi.fn();
      mockReview({ rejectOpen: true, submitReject });
      mockDetail(READY_RESULT);
      renderRoute();

      fireEvent.change(screen.getByTestId("reject-reason-input"), {
        target: { value: "  Missing export permit  " },
      });
      fireEvent.click(screen.getByTestId("reject-reason-submit"));
      expect(submitReject).toHaveBeenCalledWith("Missing export permit");
    });

    // ── Approve & mint confirmation dialog (issue #838) ─────────────────────

    it("renders the ApproveMintDialog when approveOpen is true, and NOT when false", () => {
      mockReview({ approveOpen: false });
      mockDetail(READY_RESULT);
      const { rerender } = renderRoute();
      expect(
        screen.queryByTestId("approve-mint-dialog"),
      ).not.toBeInTheDocument();

      mockReview({ approveOpen: true });
      const Page = Route.options.component as React.ComponentType;
      rerender(<Page />);
      expect(screen.getByTestId("approve-mint-dialog")).toBeInTheDocument();
    });

    it("passes detail.transactionPreview into the ApproveMintDialog", () => {
      mockReview({ approveOpen: true });
      mockDetail(READY_RESULT);
      renderRoute();
      const preview = screen.getByTestId("approve-mint-preview");
      expect(preview).toHaveTextContent("Auric Andes S.A.C.");
      expect(preview).toHaveTextContent("ipfs://auric-assay-offtake-hash");
      expect(preview).toHaveTextContent("MV Example");
    });

    it("Cancel in the approve dialog calls review.cancelApprove()", () => {
      const cancelApprove = vi.fn();
      mockReview({ approveOpen: true, cancelApprove });
      mockDetail(READY_RESULT);
      renderRoute();

      fireEvent.click(screen.getByTestId("approve-mint-cancel"));
      expect(cancelApprove).toHaveBeenCalledTimes(1);
    });

    it("Mint loan in the approve dialog calls review.approve()", () => {
      const approve = vi.fn();
      mockReview({ approveOpen: true, approve });
      mockDetail(READY_RESULT);
      renderRoute();

      fireEvent.click(screen.getByTestId("approve-mint-confirm"));
      expect(approve).toHaveBeenCalledTimes(1);
    });

    it("shows the mint's progress label on the dialog's Mint loan button while minting", () => {
      mockReview({
        approveOpen: true,
        isPending: true,
        mintingLabel: "Waiting for wallet signature…",
      });
      mockDetail(READY_RESULT);
      renderRoute();

      const confirmButton = screen.getByTestId("approve-mint-confirm");
      expect(confirmButton).toBeDisabled();
      expect(confirmButton).toHaveTextContent("Waiting for wallet signature…");
    });

    it("swaps the progress label through each mint stage inside the dialog", () => {
      mockReview({
        approveOpen: true,
        isPending: true,
        mintingLabel: "Submitting on-chain…",
      });
      mockDetail(READY_RESULT);
      const { rerender } = renderRoute();
      expect(screen.getByTestId("approve-mint-confirm")).toHaveTextContent(
        "Submitting on-chain…",
      );

      mockReview({
        approveOpen: true,
        isPending: true,
        mintingLabel: "Confirming…",
      });
      const Page = Route.options.component as React.ComponentType;
      rerender(<Page />);
      expect(screen.getByTestId("approve-mint-confirm")).toHaveTextContent(
        "Confirming…",
      );

      mockReview({
        approveOpen: true,
        isPending: true,
        mintingLabel: "Finalizing approval…",
      });
      rerender(<Page />);
      expect(screen.getByTestId("approve-mint-confirm")).toHaveTextContent(
        "Finalizing approval…",
      );
    });
  });
});
