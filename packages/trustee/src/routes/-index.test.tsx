/**
 * Smoke test for the Trustee Overview route (/), issue #797, extended #818.
 *
 * #786 shipped a placeholder body; #797 replaces it with the real Overview
 * page (header + Capital Allocation card). Since the route now mounts
 * components that issue queries, this wraps the render in a
 * `QueryClientProvider` and mocks `apiFetch` so the smoke test stays
 * deterministic and never hits the network.
 *
 * `@pipeline/wallet-connect` is mocked because `CapitalAllocationCard` now
 * (issue #805) mounts `useCapitalWalletBalance`, which statically imports
 * `@pipeline/wallet-connect` for its on-chain read. Without this mock, the
 * real module graph (down to `@creit.tech/stellar-wallets-kit`'s
 * `defaultModules()` / `@stellar/freighter-api`) gets pulled in, which can
 * fail to resolve in some sandboxes.
 *
 * Issue #818 adds the "Needs Attention" (Origination group) section, backed
 * by `GET /v1/loan-book/submissions?status=InReview` (via `NeedsAttention` →
 * `useNeedsAttention` → `useLoanSubmissions`). `apiFetch` is a single shared
 * mock across both the Capital Allocation and submissions endpoints, so it
 * dispatches on the requested URL. The pre-#818 assertion that "Needs
 * Attention" is absent no longer holds unconditionally — it is now present
 * when the submissions mock returns an in-review row, and absent when it
 * returns an empty array (the #797 guard is preserved for the empty case).
 *
 * Issue #821 wires the Needs Attention "Review" button to a real
 * `<Link to="/origination/$id">`, which needs a router context to resolve
 * (`useLinkProps` throws outside one) — this wraps the render in a minimal
 * in-test TanStack router (mirroring `-TrusteeSidebar.test.tsx`) rather than
 * mounting `<IndexPage>` bare.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  createMemoryHistory,
  Outlet,
} from "@tanstack/react-router";
import { Route } from "./index";

const CAPITAL_ALLOCATION_RESPONSE = {
  total: "115190000.000000",
  buckets: {
    capital_wallet: "8400000.000000",
    in_transit: "4950000.000000",
    withdrawal_queue: null,
    trust_account: "1200000.000000",
    deployed: "96000000.000000",
    tbills: "4640000.000000",
  },
};

const IN_REVIEW_SUBMISSION = {
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

let submissionsResponse: unknown[] = [];

vi.mock("@/api/client", () => ({
  apiFetch: vi.fn((url: string) => {
    if (url.includes("/v1/loan-book/submissions")) {
      return Promise.resolve(submissionsResponse);
    }
    return Promise.resolve(CAPITAL_ALLOCATION_RESPONSE);
  }),
}));

vi.mock("@pipeline/wallet-connect", () => ({
  getSacBalance: vi.fn().mockRejectedValue(new Error("not configured")),
}));

function buildRouter() {
  const IndexPage = Route.options.component as React.ComponentType;
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <IndexPage />,
  });
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/origination/$id",
    component: () => null,
  });
  const routeTree = rootRoute.addChildren([indexRoute, detailRoute]);
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
}

function renderIndex() {
  const router = buildRouter();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("Trustee Overview route", () => {
  it("renders without throwing", () => {
    submissionsResponse = [];
    expect(() => renderIndex()).not.toThrow();
  });

  it("shows the Overview heading", async () => {
    submissionsResponse = [];
    renderIndex();
    expect(
      await screen.findByRole("heading", { name: "Overview" }),
    ).toBeInTheDocument();
  });

  it("mounts the Capital Allocation card", async () => {
    submissionsResponse = [];
    renderIndex();
    expect(
      await screen.findByTestId("capital-allocation-card"),
    ).toBeInTheDocument();
  });

  it("does not render Cash-in-Transit or Active Deal (removed in #797)", async () => {
    submissionsResponse = [];
    renderIndex();
    await screen.findByTestId("capital-allocation-card");
    expect(screen.queryByText("Cash in Transit")).not.toBeInTheDocument();
    expect(screen.queryByText("Active Deal")).not.toBeInTheDocument();
  });

  it("does not render Needs Attention when there are no in-review submissions (empty state)", async () => {
    submissionsResponse = [];
    renderIndex();
    await screen.findByTestId("capital-allocation-card");
    expect(screen.queryByText("Needs Attention")).not.toBeInTheDocument();
    expect(screen.queryByTestId("needs-attention")).not.toBeInTheDocument();
  });

  it("renders Needs Attention (Origination group) when an in-review submission exists", async () => {
    submissionsResponse = [IN_REVIEW_SUBMISSION];
    renderIndex();
    expect(
      await screen.findByRole("heading", { name: "Needs Attention" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Origination")).toBeInTheDocument();
    expect(
      screen.getByText("Open Mineral — Copper Concentrate: new request"),
    ).toBeInTheDocument();
  });
});
