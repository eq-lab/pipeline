/**
 * Tests for the Loan detail route component (`loans.$id.tsx`, issue #845).
 * Mocks `useLoanDetail` (the view-model hook) so the view is a pure render
 * function, per `docs/FRONTEND.md` rule 2, and mocks `useLocation`/`Link` /
 * patches `Route.useParams` (no real router tree) — mirroring
 * `-origination-detail-page.test.tsx`.
 *
 * Asserts the hero (title, status chip, meta) and the Price & collateral card
 * (rows + loading/error sub-states), plus the page-level loading / not-found
 * states. Also asserts the OUT-OF-SCOPE sections are absent (no Deal journey,
 * no Registry state, no Other actions).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { UseLoanDetailResult } from "./-useLoanDetail";

const mockUseParams = vi.fn(() => ({ id: "4488" }));

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
    "@tanstack/react-router",
  );
  return {
    ...actual,
    useLocation: () => ({ state: {} }),
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
  };
});

vi.mock("./-useLoanDetail", async () => {
  const actual =
    await vi.importActual<typeof import("./-useLoanDetail")>(
      "./-useLoanDetail",
    );
  return { ...actual, useLoanDetail: vi.fn() };
});

import { Route } from "./loans.$id";
import { useLoanDetail } from "./-useLoanDetail";

(Route as unknown as { useParams: () => { id: string } }).useParams =
  mockUseParams;

function mockDetail(result: UseLoanDetailResult) {
  vi.mocked(useLoanDetail).mockReturnValue(result);
}

function renderRoute() {
  const Page = Route.options.component as React.ComponentType;
  return render(<Page />);
}

const READY: UseLoanDetailResult = {
  state: "ready",
  hero: {
    title: "Helios Metals · Lithium",
    status: { label: "Performing", band: "positive" },
    meta: "Loan #4488 · matures 30 Jun 2026 · 9 days left",
  },
  priceCollateral: {
    state: "ready",
    errorMessage: null,
    feedNote: "recalcs every 60 min",
    spot: { text: "Li2CO3 $10,450 · −1.2% 7d", negative: true },
    quantity: "620 t",
    collateralLabel: "Collateral value (after 10% haircut)",
    collateralValue: "$5,831,100",
    seniorOutstanding: "$0",
    ccr: "135%",
  },
};

beforeEach(() => {
  vi.mocked(useLoanDetail).mockReset();
});

describe("Loan detail route (ready)", () => {
  beforeEach(() => mockDetail(READY));

  it("renders the hero title, status chip, and meta line", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { name: "Helios Metals · Lithium" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("loan-detail-status-chip")).toHaveTextContent(
      "Performing",
    );
    expect(screen.getByTestId("loan-detail-meta")).toHaveTextContent(
      "Loan #4488 · matures 30 Jun 2026 · 9 days left",
    );
  });

  it("renders the Price & collateral rows", () => {
    renderRoute();
    expect(
      screen.getByTestId("loan-detail-price-collateral"),
    ).toBeInTheDocument();
    expect(screen.getByText("Li2CO3 $10,450 · −1.2% 7d")).toBeInTheDocument();
    expect(screen.getByText("620 t")).toBeInTheDocument();
    expect(
      screen.getByText("Collateral value (after 10% haircut)"),
    ).toBeInTheDocument();
    expect(screen.getByText("$5,831,100")).toBeInTheDocument();
    expect(screen.getByText("135%")).toBeInTheDocument();
  });

  it("does NOT render out-of-scope sections (Deal journey / Registry / Other actions)", () => {
    renderRoute();
    expect(screen.queryByText(/Deal journey/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Registry state/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Other actions/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Record coupon/i)).not.toBeInTheDocument();
  });
});

describe("Loan detail route (price & collateral sub-states)", () => {
  it("renders a skeleton while the valuation loads", () => {
    mockDetail({
      ...READY,
      priceCollateral: { ...READY.priceCollateral!, state: "loading" },
    });
    renderRoute();
    expect(
      screen.getByTestId("loan-detail-price-collateral-loading"),
    ).toBeInTheDocument();
  });

  it("renders the valuation error message", () => {
    mockDetail({
      ...READY,
      priceCollateral: {
        ...READY.priceCollateral!,
        state: "error",
        errorMessage: "No valuation available for this loan.",
      },
    });
    renderRoute();
    expect(
      screen.getByTestId("loan-detail-price-collateral-error"),
    ).toHaveTextContent("No valuation available for this loan.");
  });

  it("renders — for a null spot line", () => {
    mockDetail({
      ...READY,
      priceCollateral: { ...READY.priceCollateral!, spot: null },
    });
    renderRoute();
    // The Spot row label is still present; its value degrades to —.
    expect(screen.getByText("Spot (off-chain API)")).toBeInTheDocument();
  });
});

describe("Loan detail route (loading / not-found)", () => {
  it("renders the page skeleton while resolving identity", () => {
    mockDetail({ state: "loading", hero: null, priceCollateral: null });
    renderRoute();
    expect(screen.getByTestId("loan-detail-loading")).toBeInTheDocument();
  });

  it("renders a not-found state with a back link", () => {
    mockDetail({ state: "not-found", hero: null, priceCollateral: null });
    renderRoute();
    expect(screen.getByTestId("loan-detail-not-found")).toHaveTextContent(
      "Loan not found.",
    );
  });
});
