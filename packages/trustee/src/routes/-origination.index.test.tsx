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
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
  facility: "$6,000,000",
  corridor: "CL → KR",
  rate: "13.0%",
  maturity: "30 Jun 2026",
  submitted: "2 Jan",
  status: { kind: "approved", label: "Approved & minted · 2 Jan" },
  submission: { ...SUBMISSION, id: 2 },
};

const IN_REVIEW_ROW: OriginationTableRow = {
  id: 1,
  originator: "Auric Andes",
  commodity: "Gold pyrite concentrate",
  facility: "$3,500,000",
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
  facility: "$1,200,000",
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

const MISSING_FIELD_ROW: OriginationTableRow = {
  id: 4,
  originator: "—",
  commodity: "—",
  facility: "—",
  corridor: "—",
  rate: "—",
  maturity: "—",
  submitted: "—",
  status: { kind: "unknown", label: "—" },
  submission: { ...SUBMISSION, id: 4 },
};

describe("Origination route", () => {
  it("renders without throwing", () => {
    mockTable({ state: "empty", errorMessage: null, rows: [] });
    expect(() => renderRoute()).not.toThrow();
  });

  it("shows the Origination heading", async () => {
    mockTable({ state: "empty", errorMessage: null, rows: [] });
    renderRoute();
    expect(
      await screen.findByRole("heading", { name: "Origination" }),
    ).toBeInTheDocument();
  });

  it("does not render the Figma footer note (deliberately omitted)", async () => {
    mockTable({ state: "empty", errorMessage: null, rows: [] });
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
    mockTable({ state: "loading", errorMessage: null, rows: [] });
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
      rows: [],
    });
    renderRoute();
    const alert = await screen.findByTestId("origination-error");
    expect(alert).toBeInTheDocument();
    expect(alert.textContent).toContain("Failed to fetch");
  });

  it("renders an empty-state caption", async () => {
    mockTable({ state: "empty", errorMessage: null, rows: [] });
    renderRoute();
    expect((await screen.findByTestId("origination-empty")).textContent).toBe(
      "No loans in origination.",
    );
  });

  it("renders table rows for each status: Approved, InReview, Rejected", async () => {
    mockTable({
      state: "ready",
      errorMessage: null,
      rows: [IN_REVIEW_ROW, APPROVED_ROW, REJECTED_ROW],
    });
    renderRoute();

    expect(await screen.findAllByTestId("origination-row")).toHaveLength(3);

    // InReview -> live "Review" link to the detail page.
    const reviewLink = screen.getByTestId("origination-status-review");
    expect(reviewLink).not.toBeDisabled();
    expect(reviewLink).toHaveTextContent("Review");
    expect(reviewLink).toHaveAttribute("href", "/origination/1");

    // Approved -> green pill with the mint date.
    expect(screen.getByTestId("origination-status-approved")).toHaveTextContent(
      "Approved & minted · 2 Jan",
    );

    // Rejected -> red pill with the reason available on hover (title attr).
    const rejectedPill = screen.getByTestId("origination-status-rejected");
    expect(rejectedPill).toHaveTextContent("Rejected");
    expect(rejectedPill).toHaveAttribute("title", "Missing export permit");
  });

  it("clicking the Review link navigates to /origination/$id with the row's SubmissionView as state", async () => {
    mockTable({
      state: "ready",
      errorMessage: null,
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
      rows: [IN_REVIEW_ROW],
    });
    renderRoute();
    const reviewLink = await screen.findByTestId("origination-status-review");
    expect(reviewLink.tagName).toBe("A");
    expect(reviewLink).not.toHaveAttribute("aria-disabled");
  });

  it("does not render a valuation sub-line under the commodity", async () => {
    mockTable({ state: "ready", errorMessage: null, rows: [APPROVED_ROW] });
    renderRoute();
    await screen.findByTestId("origination-status-approved");
    expect(screen.queryByText(/NSR/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Standard · price/)).not.toBeInTheDocument();
  });

  it("renders '—' for missing fields rather than fabricating a value", async () => {
    mockTable({
      state: "ready",
      errorMessage: null,
      rows: [MISSING_FIELD_ROW],
    });
    renderRoute();
    const row = await screen.findByTestId("origination-row");
    expect(row.textContent).toContain("—");
    expect(screen.getByTestId("origination-status-unknown")).toHaveTextContent(
      "—",
    );
  });
});
