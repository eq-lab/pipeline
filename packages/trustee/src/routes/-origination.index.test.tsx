/**
 * Tests for the real Origination route (issue #813, Review control wired to
 * `/origination/$id` in issue #821) — the page heading, the submissions
 * table (all three statuses), loading / error / empty states, and "—" for a
 * missing field. The Figma static footer note is deliberately NOT rendered
 * (human review follow-up on this issue) — see the "does not render the
 * Figma footer note" test below. Mocks `useOriginationTable` (the
 * field-mapping and query-state hook) so the view is exercised as a pure
 * render function, per `docs/FRONTEND.md` rule 2.
 *
 * Mounts a minimal in-test TanStack router (mirroring
 * `-TrusteeSidebar.test.tsx`) so the in-review row's `Link` resolves without
 * the full app router tree.
 *
 * Issue #823 adds whole-row-click navigation for ALL statuses (Approved/
 * Rejected/InReview), keyboard (Enter) navigation, and asserts the InReview
 * row's Review `Link` doesn't double-navigate when clicked (its `onClick`
 * stops propagation to the row handler — both target the same URL).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  createMemoryHistory,
  useLocation,
  Outlet,
} from "@tanstack/react-router";
import { Route } from "./origination.index";
import { useOriginationTable } from "./-useOriginationTable";
import type {
  OriginationTableRow,
  UseOriginationTableResult,
} from "./-useOriginationTable";
import type { SubmissionView } from "@/api/useLoanSubmissions";

vi.mock("./-useOriginationTable", async () => {
  const actual = await vi.importActual<typeof import("./-useOriginationTable")>(
    "./-useOriginationTable",
  );
  return {
    ...actual,
    useOriginationTable: vi.fn(),
  };
});

function mockTable(result: UseOriginationTableResult) {
  vi.mocked(useOriginationTable).mockReturnValue(result);
}

/** Records the location observed by a child route, so navigation can be asserted. */
function LocationRecorder({
  onLocation,
}: {
  onLocation: (state: unknown, pathname: string) => void;
}) {
  const location = useLocation();
  onLocation(location.state, location.pathname);
  return <p data-testid="detail-route-marker">detail route</p>;
}

/** Builds a minimal in-test router: `/origination` renders the real route, `/origination/$id` records the navigation. */
function buildRouter(
  onDetailLocation: (state: unknown, pathname: string) => void,
) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const OriginationPage = Route.options.component as React.ComponentType;
  const originationRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/origination",
    component: () => <OriginationPage />,
  });
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/origination/$id",
    component: () => <LocationRecorder onLocation={onDetailLocation} />,
  });
  const routeTree = rootRoute.addChildren([originationRoute, detailRoute]);
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/origination"] }),
  });
}

function renderRoute(
  onDetailLocation: (state: unknown, pathname: string) => void = () => {},
) {
  const router = buildRouter(onDetailLocation);
  return render(<RouterProvider router={router} />);
}

const SUBMISSION: SubmissionView = {
  id: 1,
  status: "InReview",
  reason: null,
  originator: "Auric Andes",
  created_at: "2026-06-18T10:00:00Z",
  updated_at: "2026-06-18T10:00:00Z",
  documents: [],
  loan_data: {
    to: "G...",
    metadata_uri: "ipfs://...",
    originator: "Auric Andes S.A.C.",
    borrower_id: "borrower-1",
    commodity: "Gold pyrite concentrate",
    corridor: "PE-CN",
    governing_law: "England",
    economics: {
      original_facility_size: "3500000.000000",
      original_senior_tranche: "3000000.000000",
      original_equity_tranche: "500000.000000",
      original_offtaker_price: "3500000.000000",
      senior_interest_rate_bps: 1400,
      origination_date: 1_750_000_000,
      original_maturity_date: 1_797_292_800,
    },
    initial_ccr: 1_500_000,
    initial_location: {
      location_type: "Vessel",
      location_identifier: "MV Example",
      tracking_url: "https://example.com",
      updated_at: 1_750_000_000,
    },
  },
};

const APPROVED_ROW: OriginationTableRow = {
  id: 2,
  originator: "Helios Metals",
  commodity: "Lithium carbonate",
  facility: "$6M",
  corridor: "CL → KR",
  rate: "13.0%",
  maturity: "30 Jun 2026",
  submitted: "2 Jan",
  status: { kind: "approved", label: "Approved · 2 Jan" },
  submission: { ...SUBMISSION, id: 2 },
};

const IN_REVIEW_ROW: OriginationTableRow = {
  id: 1,
  originator: "Auric Andes",
  commodity: "Gold pyrite concentrate",
  facility: "$3.5M",
  corridor: "PE → CN",
  rate: "14.0%",
  maturity: "15 Dec 2026",
  submitted: "18 Jun",
  status: { kind: "in-review", label: "Review" },
  submission: SUBMISSION,
};

const REJECTED_ROW: OriginationTableRow = {
  id: 3,
  originator: "Delta Ore",
  commodity: "Copper cathode",
  facility: "$1.2M",
  corridor: "CL → US",
  rate: "11.5%",
  maturity: "1 Mar 2027",
  submitted: "5 May",
  status: {
    kind: "rejected",
    label: "Rejected",
    reason: "Missing export permit",
  },
  submission: { ...SUBMISSION, id: 3 },
};

const CHANGES_REQUESTED_ROW: OriginationTableRow = {
  id: 5,
  originator: "Epsilon Grain",
  commodity: "Wheat",
  facility: "$800K",
  corridor: "UA → EG",
  rate: "10.0%",
  maturity: "1 Apr 2027",
  submitted: "6 May",
  status: {
    kind: "changes-requested",
    label: "Changes requested",
    reason: "Attach the amended offtake agreement",
  },
  submission: { ...SUBMISSION, id: 5 },
};

const MISSING_FIELD_ROW: OriginationTableRow = {
  id: 4,
  originator: "—",
  commodity: "—",
  facility: "—",
  corridor: "—",
  rate: "—",
  maturity: "—",
  submitted: "—",
  status: { kind: "approved", label: "Approved · —" },
  submission: { ...SUBMISSION, id: 4 },
};

describe("Origination route", () => {
  it("renders without throwing", () => {
    mockTable({
      state: "empty",
      errorMessage: null,
      errorDetails: null,
      rows: [],
    });
    expect(() => renderRoute()).not.toThrow();
  });

  it("shows the Origination heading", async () => {
    mockTable({
      state: "empty",
      errorMessage: null,
      errorDetails: null,
      rows: [],
    });
    renderRoute();
    expect(
      await screen.findByRole("heading", { name: "Origination" }),
    ).toBeInTheDocument();
  });

  it("renders the Submit-a-loan action linking to /origination/new (#1100)", async () => {
    mockTable({
      state: "empty",
      errorMessage: null,
      errorDetails: null,
      rows: [],
    });
    renderRoute();
    const link = await screen.findByTestId("origination-submit-loan");
    expect(link).toHaveTextContent("Submit a loan");
    expect(link).toHaveAttribute("href", "/origination/new");
  });

  it("does not render the Figma footer note (deliberately omitted)", async () => {
    mockTable({
      state: "empty",
      errorMessage: null,
      errorDetails: null,
      rows: [],
    });
    renderRoute();
    await screen.findByRole("heading", { name: "Origination" });
    expect(
      screen.queryByTestId("origination-footer-note"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/document set adapts to the commodity/),
    ).not.toBeInTheDocument();
  });

  it("renders a loading skeleton", async () => {
    mockTable({
      state: "loading",
      errorMessage: null,
      errorDetails: null,
      rows: [],
    });
    renderRoute();
    expect(
      await screen.findByTestId("origination-loading"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("origination-table")).not.toBeInTheDocument();
  });

  it("renders an inline error surface", async () => {
    mockTable({
      state: "error",
      errorMessage: "Failed to fetch",
      errorDetails: null,
      rows: [],
    });
    renderRoute();
    const alert = await screen.findByTestId("origination-error");
    expect(alert).toBeInTheDocument();
    expect(alert.textContent).toContain("Failed to fetch");
  });

  it("wires errorDetails through to InlineError's View details trigger (#1037)", async () => {
    const user = userEvent.setup();
    mockTable({
      state: "error",
      errorMessage: "Failed to load loan submissions.",
      errorDetails: "raw backend diagnostic text",
      rows: [],
    });
    renderRoute();
    await screen.findByTestId("origination-error");
    await user.click(screen.getByTestId("inline-error-view-details"));
    expect(screen.getByTestId("error-details-raw")).toHaveTextContent(
      "raw backend diagnostic text",
    );
  });

  it("renders an empty-state caption", async () => {
    mockTable({
      state: "empty",
      errorMessage: null,
      errorDetails: null,
      rows: [],
    });
    renderRoute();
    expect((await screen.findByTestId("origination-empty")).textContent).toBe(
      "No loans in origination.",
    );
  });

  it("renders table rows for each status: Approved, InReview, Rejected", async () => {
    mockTable({
      state: "ready",
      errorMessage: null,
      errorDetails: null,
      rows: [IN_REVIEW_ROW, APPROVED_ROW, REJECTED_ROW, CHANGES_REQUESTED_ROW],
    });
    renderRoute();

    expect(await screen.findAllByTestId("origination-row")).toHaveLength(4);

    // InReview -> live "Review" link to the detail page.
    const reviewLink = screen.getByTestId("origination-status-review");
    expect(reviewLink).not.toBeDisabled();
    expect(reviewLink).toHaveTextContent("Review");
    expect(reviewLink).toHaveAttribute("href", "/origination/1");

    // Approved -> green pill with the mint date.
    expect(screen.getByTestId("origination-status-approved")).toHaveTextContent(
      "Approved · 2 Jan",
    );

    // Rejected -> red pill with the reason available on hover (title attr).
    const rejectedPill = screen.getByTestId("origination-status-rejected");
    expect(rejectedPill).toHaveTextContent("Rejected");
    expect(rejectedPill).toHaveAttribute("title", "Missing export permit");

    // ChangesRequested -> amber pill with the reason on hover (#950), NOT Approved.
    const changesPill = screen.getByTestId(
      "origination-status-changes-requested",
    );
    expect(changesPill).toHaveTextContent("Changes requested");
    expect(changesPill).toHaveAttribute(
      "title",
      "Attach the amended offtake agreement",
    );
  });

  it("clicking the Review link navigates to /origination/$id with the row's SubmissionView as state", async () => {
    mockTable({
      state: "ready",
      errorMessage: null,
      errorDetails: null,
      rows: [IN_REVIEW_ROW],
    });
    const onDetailLocation = vi.fn();
    renderRoute(onDetailLocation);

    fireEvent.click(await screen.findByTestId("origination-status-review"));

    const marker = await screen.findByTestId("detail-route-marker");
    expect(marker).toBeInTheDocument();
    expect(onDetailLocation).toHaveBeenCalledWith(
      expect.objectContaining({ submission: SUBMISSION }),
      "/origination/1",
    );
  });

  it("the Review link is keyboard-focusable (not disabled/inert)", async () => {
    mockTable({
      state: "ready",
      errorMessage: null,
      errorDetails: null,
      rows: [IN_REVIEW_ROW],
    });
    renderRoute();
    const reviewLink = await screen.findByTestId("origination-status-review");
    expect(reviewLink.tagName).toBe("A");
    expect(reviewLink).not.toHaveAttribute("aria-disabled");
  });

  it("does not render a valuation sub-line under the commodity", async () => {
    mockTable({
      state: "ready",
      errorMessage: null,
      errorDetails: null,
      rows: [APPROVED_ROW],
    });
    renderRoute();
    await screen.findByTestId("origination-status-approved");
    expect(screen.queryByText(/NSR/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Standard · price/)).not.toBeInTheDocument();
  });

  it("renders '—' for missing fields rather than fabricating a value", async () => {
    mockTable({
      state: "ready",
      errorMessage: null,
      errorDetails: null,
      rows: [MISSING_FIELD_ROW],
    });
    renderRoute();
    const row = await screen.findByTestId("origination-row");
    expect(row.textContent).toContain("—");
    expect(screen.getByTestId("origination-status-approved")).toHaveTextContent(
      "Approved · —",
    );
  });

  // ── Row-click navigation (issue #823) ─────────────────────────────────────

  describe("row-click navigation", () => {
    it("clicking an Approved row navigates to /origination/2 with the row's SubmissionView as state", async () => {
      mockTable({
        state: "ready",
        errorMessage: null,
        errorDetails: null,
        rows: [APPROVED_ROW],
      });
      const onDetailLocation = vi.fn();
      renderRoute(onDetailLocation);

      fireEvent.click(await screen.findByTestId("origination-row"));

      const marker = await screen.findByTestId("detail-route-marker");
      expect(marker).toBeInTheDocument();
      expect(onDetailLocation).toHaveBeenCalledWith(
        expect.objectContaining({ submission: APPROVED_ROW.submission }),
        "/origination/2",
      );
    });

    it("clicking a Rejected row navigates to /origination/3 with the row's SubmissionView as state", async () => {
      mockTable({
        state: "ready",
        errorMessage: null,
        errorDetails: null,
        rows: [REJECTED_ROW],
      });
      const onDetailLocation = vi.fn();
      renderRoute(onDetailLocation);

      fireEvent.click(await screen.findByTestId("origination-row"));

      const marker = await screen.findByTestId("detail-route-marker");
      expect(marker).toBeInTheDocument();
      expect(onDetailLocation).toHaveBeenCalledWith(
        expect.objectContaining({ submission: REJECTED_ROW.submission }),
        "/origination/3",
      );
    });

    it("clicking an InReview row (not the Review link itself) navigates to /origination/1", async () => {
      mockTable({
        state: "ready",
        errorMessage: null,
        errorDetails: null,
        rows: [IN_REVIEW_ROW],
      });
      const onDetailLocation = vi.fn();
      renderRoute(onDetailLocation);

      fireEvent.click(await screen.findByTestId("origination-row"));

      const marker = await screen.findByTestId("detail-route-marker");
      expect(marker).toBeInTheDocument();
      expect(onDetailLocation).toHaveBeenCalledWith(
        expect.objectContaining({ submission: SUBMISSION }),
        "/origination/1",
      );
    });

    it("pressing Enter on a focused row navigates to the detail page (keyboard path)", async () => {
      mockTable({
        state: "ready",
        errorMessage: null,
        errorDetails: null,
        rows: [APPROVED_ROW],
      });
      const onDetailLocation = vi.fn();
      renderRoute(onDetailLocation);

      const row = await screen.findByTestId("origination-row");
      row.focus();
      fireEvent.keyDown(row, { key: "Enter" });

      const marker = await screen.findByTestId("detail-route-marker");
      expect(marker).toBeInTheDocument();
      expect(onDetailLocation).toHaveBeenCalledWith(
        expect.objectContaining({ submission: APPROVED_ROW.submission }),
        "/origination/2",
      );
    });

    it("clicking the Review link navigates exactly once (no double-navigation from the row handler)", async () => {
      mockTable({
        state: "ready",
        errorMessage: null,
        errorDetails: null,
        rows: [IN_REVIEW_ROW],
      });
      const onDetailLocation = vi.fn();
      renderRoute(onDetailLocation);

      fireEvent.click(await screen.findByTestId("origination-status-review"));

      await screen.findByTestId("detail-route-marker");
      // The child route mounts once per navigation; a double-fire would
      // render the marker/observer twice via re-navigation, but a single
      // navigation call is the direct signal a duplicate history entry did
      // NOT occur (stopPropagation on the Review link prevents the row's
      // own onClick from also firing).
      expect(onDetailLocation).toHaveBeenCalledTimes(1);
    });

    it("each row is focusable (tabIndex 0) and has an accessible name", async () => {
      mockTable({
        state: "ready",
        errorMessage: null,
        errorDetails: null,
        rows: [IN_REVIEW_ROW, APPROVED_ROW, REJECTED_ROW],
      });
      renderRoute();

      const rows = await screen.findAllByTestId("origination-row");
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        expect(row).toHaveAttribute("tabIndex", "0");
        expect(row.getAttribute("aria-label")).toMatch(/^Open .+ submission$/);
      }
    });
  });
});
