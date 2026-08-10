/**
 * Render tests for `NeedsAttention.tsx` — the Overview page's Needs
 * Attention section, Origination group ONLY (issue #818, Review button
 * wired to `/origination/$id` in issue #821).
 *
 * Covers:
 *   - Renders the "Needs Attention" heading + "Origination" group header +
 *     one row per in-review submission, with the expected title/subtitle.
 *   - Renders nothing (no heading, `queryByTestId("needs-attention")` null)
 *     when there are no in-review submissions (empty state).
 *   - Renders nothing on loading/error (supplementary block, not primary
 *     content — resolved default per the exec plan).
 *   - The "Review" button navigates to `/origination/$id` with the row's
 *     `SubmissionView` as router state, and is keyboard-focusable (not
 *     disabled).
 *
 * Mounts a minimal in-test TanStack router (mirroring
 * `-TrusteeSidebar.test.tsx`) so the `Link` resolves without the full app
 * router tree, and asserts on the resolved `href` + navigation outcome
 * rather than reaching into TanStack Router internals.
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
import { NeedsAttention } from "./NeedsAttention";
import type {
  LoanNeedsAttentionRow,
  NeedsAttentionRow,
  UseNeedsAttentionResult,
} from "./useNeedsAttention";
import type { SubmissionView } from "@/api/useLoanSubmissions";

const mockUseNeedsAttention = vi.fn<() => UseNeedsAttentionResult>();

vi.mock("./useNeedsAttention", () => ({
  useNeedsAttention: () => mockUseNeedsAttention(),
}));

const SUBMISSION: SubmissionView = {
  id: 1,
  status: "InReview",
  reason: null,
  originator: "0xSubmitterAddress",
  created_at: "2026-06-18T10:00:00Z",
  updated_at: "2026-06-18T10:00:00Z",
  documents: [],
  loan_data: {
    to: "G...",
    metadata_uri: "ipfs://...",
    originator: "Open Mineral",
    borrower_id: "borrower-1",
    commodity: "Copper Concentrate",
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

const ROW_1: NeedsAttentionRow = {
  id: 1,
  title: "Open Mineral — Copper Concentrate: new request",
  subtitle: "Copper Concentrate · PE → CN · submitted 18 Jun",
  submission: SUBMISSION,
};

const ROW_2: NeedsAttentionRow = {
  id: 2,
  title: "Auric Andes — Gold Pyrite Concentrate: new request",
  subtitle: "Gold Pyrite Concentrate · submitted 20 Jun",
  submission: { ...SUBMISSION, id: 2 },
};

/** A ChangesRequested-sourced row (#1046) — same shell, status-derived title. */
const ROW_CHANGES_REQUESTED: NeedsAttentionRow = {
  id: 7,
  title: "Open Mineral — Copper Concentrate: changes requested",
  subtitle: "Copper Concentrate · PE → CN · submitted 18 Jun",
  submission: {
    ...SUBMISSION,
    id: 7,
    status: "ChangesRequested",
    reason: "Missing insurance certificate",
  },
};

const LOAN_ROW: LoanNeedsAttentionRow = {
  loanId: "4471",
  title: "Delta Commodities · Coffee",
  subtitle: "Watchlist · loan #4471",
};

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

/** Builds a minimal in-test router: `/` renders NeedsAttention, `/origination/$id` records the navigation. */
function buildRouter(
  onDetailLocation: (state: unknown, pathname: string) => void,
) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <NeedsAttention />,
  });
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/origination/$id",
    component: () => <LocationRecorder onLocation={onDetailLocation} />,
  });
  const loanRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/loans/$id",
    component: () => <p data-testid="loan-route-marker">loan route</p>,
  });
  const routeTree = rootRoute.addChildren([indexRoute, detailRoute, loanRoute]);
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
}

function renderNeedsAttention(
  onDetailLocation: (state: unknown, pathname: string) => void = () => {},
) {
  const router = buildRouter(onDetailLocation);
  return render(<RouterProvider router={router} />);
}

describe("NeedsAttention", () => {
  it("renders the heading, group header, and one row per in-review submission", async () => {
    mockUseNeedsAttention.mockReturnValue({
      state: "ready",
      errorMessage: null,
      rows: [ROW_1],
      loanRows: [],
    });

    renderNeedsAttention();

    expect(
      await screen.findByRole("heading", { name: "Needs Attention" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Origination")).toBeInTheDocument();
    expect(screen.getByTestId("needs-attention")).toBeInTheDocument();
    expect(
      screen.getByTestId("needs-attention-origination"),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("needs-attention-row")).toHaveLength(1);
    expect(
      screen.getByText("Open Mineral — Copper Concentrate: new request"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Copper Concentrate · PE → CN · submitted 18 Jun"),
    ).toBeInTheDocument();
  });

  it("renders a ChangesRequested row with its status title and the same Review link (#1046)", async () => {
    mockUseNeedsAttention.mockReturnValue({
      state: "ready",
      errorMessage: null,
      rows: [ROW_CHANGES_REQUESTED],
      loanRows: [],
    });

    renderNeedsAttention();

    expect(
      await screen.findByText(
        "Open Mineral — Copper Concentrate: changes requested",
      ),
    ).toBeInTheDocument();
    const link = screen.getByTestId("needs-attention-review");
    expect(link).toHaveAttribute("href", "/origination/7");
    expect(link).toHaveTextContent("Review");
  });

  it("renders one row per in-review submission when there are multiple", async () => {
    mockUseNeedsAttention.mockReturnValue({
      state: "ready",
      errorMessage: null,
      rows: [ROW_1, ROW_2],
      loanRows: [],
    });

    renderNeedsAttention();
    expect(await screen.findAllByTestId("needs-attention-row")).toHaveLength(2);
  });

  it("renders the Loans group with an Open link per Watchlist/Matured loan (#867)", async () => {
    mockUseNeedsAttention.mockReturnValue({
      state: "ready",
      errorMessage: null,
      rows: [],
      loanRows: [LOAN_ROW],
    });

    renderNeedsAttention();

    expect(
      await screen.findByTestId("needs-attention-loans"),
    ).toBeInTheDocument();
    expect(screen.getByText("Loans")).toBeInTheDocument();
    expect(screen.getByText("Delta Commodities · Coffee")).toBeInTheDocument();
    const open = screen.getByTestId("needs-attention-open");
    expect(open).toHaveAttribute("href", "/loans/4471");
    expect(open).toHaveTextContent("Open");
    // Origination group is absent when there are no in-review submissions.
    expect(
      screen.queryByTestId("needs-attention-origination"),
    ).not.toBeInTheDocument();
  });

  it("renders the Review control as a live, keyboard-focusable link (not disabled)", async () => {
    mockUseNeedsAttention.mockReturnValue({
      state: "ready",
      errorMessage: null,
      rows: [ROW_1],
      loanRows: [],
    });

    renderNeedsAttention();

    const link = await screen.findByTestId("needs-attention-review");
    expect(link).not.toBeDisabled();
    expect(link).not.toHaveAttribute("aria-disabled");
    expect(link).toHaveAttribute("href", "/origination/1");
    expect(link).toHaveAccessibleName("Review submission");
    expect(link).toHaveTextContent("Review");
    // Anchors are natively keyboard-focusable/activatable — no tabIndex override needed.
    expect(link.tagName).toBe("A");
  });

  it("clicking Review navigates to /origination/$id with the row's SubmissionView as state", async () => {
    mockUseNeedsAttention.mockReturnValue({
      state: "ready",
      errorMessage: null,
      rows: [ROW_1],
      loanRows: [],
    });

    const onDetailLocation = vi.fn();
    renderNeedsAttention(onDetailLocation);

    fireEvent.click(await screen.findByTestId("needs-attention-review"));

    const marker = await screen.findByTestId("detail-route-marker");
    expect(marker).toBeInTheDocument();
    expect(onDetailLocation).toHaveBeenCalledWith(
      expect.objectContaining({ submission: SUBMISSION }),
      "/origination/1",
    );
  });

  it("renders nothing (whole section absent) when state is 'empty'", () => {
    mockUseNeedsAttention.mockReturnValue({
      state: "empty",
      errorMessage: null,
      rows: [],
      loanRows: [],
    });

    renderNeedsAttention();

    expect(screen.queryByTestId("needs-attention")).not.toBeInTheDocument();
    expect(screen.queryByText("Needs Attention")).not.toBeInTheDocument();
    expect(screen.queryByText("Origination")).not.toBeInTheDocument();
  });

  it("renders nothing while loading (no skeleton — supplementary block)", () => {
    mockUseNeedsAttention.mockReturnValue({
      state: "loading",
      errorMessage: null,
      rows: [],
      loanRows: [],
    });

    renderNeedsAttention();

    expect(screen.queryByTestId("needs-attention")).not.toBeInTheDocument();
  });

  it("renders nothing on error (omits the section rather than showing an error surface)", () => {
    mockUseNeedsAttention.mockReturnValue({
      state: "error",
      errorMessage: "network down",
      rows: [],
      loanRows: [],
    });

    renderNeedsAttention();

    expect(screen.queryByTestId("needs-attention")).not.toBeInTheDocument();
  });
});
