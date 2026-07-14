/**
 * Render tests for the Loan detail route (`loans.$id.tsx`, issues #845 / #847).
 * The view-model hook `useLoanDetail` is mocked so the component is exercised as
 * a pure render function (FRONTEND.md rule 2); the presenter's own logic is
 * covered by `-useLoanDetail.test.ts`. `Link` and `Route.useParams` are patched
 * (no real router tree), mirroring `-origination-detail-page.test.tsx`.
 *
 * Asserts the live hero (identity + band chip), the live Price & collateral card
 * (provider note, two-tone spot, rows, `missing_inputs` note, plus its own
 * loading / error states), the still-mock sections, the back link, and the
 * top-level loading / error states.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { UseLoanDetailResult } from "./-useLoanDetail";
import { LOAN_DETAIL_MOCK } from "./-loanDetailMock";

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
    "@tanstack/react-router",
  );
  return {
    ...actual,
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
  };
});

const mockUseLoanDetail = vi.fn<() => UseLoanDetailResult>();
vi.mock("./-useLoanDetail", () => ({
  useLoanDetail: () => mockUseLoanDetail(),
}));

import { Route } from "./loans.$id";

// `Route.useParams` is the file-route-bound accessor the component calls; patch
// it directly since the route isn't mounted in a real router tree here.
(Route as unknown as { useParams: () => { id: string } }).useParams = () => ({
  id: "4488",
});

function renderRoute() {
  const Page = Route.options.component as React.ComponentType;
  return render(<Page />);
}

function makeResult(
  overrides: Partial<UseLoanDetailResult> = {},
): UseLoanDetailResult {
  return {
    state: "ready",
    errorMessage: null,
    hero: {
      backLabel: "‹ Loans",
      title: "Helios Metals · Lithium",
      status: { label: "Performing", band: "positive" },
      meta: "Loan #4488 · on-chain Performing",
    },
    lifecycle: [
      {
        label: "Origination",
        sub: "reviewed & approved",
        state: "done",
        index: 1,
      },
      {
        label: "Disbursing",
        sub: "minted, not yet funded",
        state: "done",
        index: 2,
      },
      {
        label: "Performing",
        sub: "deployed & current",
        state: "active",
        index: 3,
      },
      { label: "Watchlist", sub: "elevated risk", state: "pending", index: 4 },
      { label: "Past Due", sub: "overdue, unpaid", state: "pending", index: 5 },
      { label: "Default", sub: "council declared", state: "pending", index: 6 },
      { label: "Closed", sub: "terminal", state: "pending", index: 7 },
    ],
    tiles: LOAN_DETAIL_MOCK.tiles,
    registry: LOAN_DETAIL_MOCK.registry,
    currentStage: LOAN_DETAIL_MOCK.currentStage,
    otherActions: LOAN_DETAIL_MOCK.otherActions,
    priceCollateral: {
      state: "ready",
      errorMessage: null,
      providerNote: "via coingecko",
      spot: { main: "$10,450", change: "−1.2% 7d", changeNegative: true },
      rows: [
        { label: "Quantity", value: "620 dmt" },
        { label: "Collateral value (after 10% haircut)", value: "$5,831,100" },
        { label: "Senior outstanding", value: "$4,950,000" },
        { label: "CCR", value: "117.80%" },
      ],
      missingNote: null,
    },
    ...overrides,
  };
}

beforeEach(() => {
  mockUseLoanDetail.mockReset();
  mockUseLoanDetail.mockReturnValue(makeResult());
});

describe("Loan detail route — hero (live)", () => {
  it("renders the identity title, band chip, and meta", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { name: "Helios Metals · Lithium" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("loan-detail-status-chip")).toHaveTextContent(
      "Performing",
    );
    expect(screen.getByTestId("loan-detail-meta")).toHaveTextContent(
      "Loan #4488 · on-chain Performing",
    );
  });

  it("has a back link to /loans", () => {
    renderRoute();
    expect(screen.getByText("‹ Loans").closest("a")).toHaveAttribute(
      "href",
      "/loans",
    );
  });
});

describe("Loan detail route — Price & collateral (live)", () => {
  it("renders the provider note, two-tone spot, and the four rows", () => {
    renderRoute();
    const pc = screen.getByTestId("loan-detail-price-collateral");
    expect(within(pc).getByText("via coingecko")).toBeInTheDocument();
    expect(within(pc).getByText("$10,450")).toBeInTheDocument();
    expect(within(pc).getByText("−1.2% 7d")).toBeInTheDocument();
    expect(within(pc).getByText("620 dmt")).toBeInTheDocument();
    expect(
      within(pc).getByText("Collateral value (after 10% haircut)"),
    ).toBeInTheDocument();
    expect(within(pc).getByText("$5,831,100")).toBeInTheDocument();
    expect(within(pc).getByText("117.80%")).toBeInTheDocument();
  });

  it("renders the missing-inputs note when the valuation is incomplete", () => {
    mockUseLoanDetail.mockReturnValue(
      makeResult({
        priceCollateral: {
          state: "ready",
          errorMessage: null,
          providerNote: "",
          spot: { main: "—", change: null, changeNegative: false },
          rows: [
            { label: "Quantity", value: "—" },
            { label: "Collateral value (after 10% haircut)", value: "—" },
            { label: "Senior outstanding", value: "—" },
            { label: "CCR", value: "—" },
          ],
          missingNote: "Awaiting: reference_price, quantity",
        },
      }),
    );
    renderRoute();
    expect(
      screen.getByTestId("loan-detail-price-collateral-missing"),
    ).toHaveTextContent("Awaiting: reference_price, quantity");
  });

  it("renders the P&C loading skeleton while the valuation loads", () => {
    mockUseLoanDetail.mockReturnValue(
      makeResult({
        priceCollateral: {
          state: "loading",
          errorMessage: null,
          providerNote: "",
          spot: { main: "—", change: null, changeNegative: false },
          rows: [],
          missingNote: null,
        },
      }),
    );
    renderRoute();
    expect(
      screen.getByTestId("loan-detail-price-collateral-loading"),
    ).toBeInTheDocument();
  });

  it("renders a neutral 'no valuation' note for a 404 (empty state)", () => {
    mockUseLoanDetail.mockReturnValue(
      makeResult({
        priceCollateral: {
          state: "empty",
          errorMessage: null,
          providerNote: "",
          spot: { main: "—", change: null, changeNegative: false },
          rows: [],
          missingNote: "No valuation on record for this loan.",
        },
      }),
    );
    renderRoute();
    expect(
      screen.getByTestId("loan-detail-price-collateral-empty"),
    ).toHaveTextContent("No valuation on record for this loan.");
    // Not a red error alert.
    expect(
      screen.queryByTestId("loan-detail-price-collateral-error"),
    ).not.toBeInTheDocument();
  });

  it("renders the P&C error message when the valuation fails", () => {
    mockUseLoanDetail.mockReturnValue(
      makeResult({
        priceCollateral: {
          state: "error",
          errorMessage: "boom",
          providerNote: "",
          spot: { main: "—", change: null, changeNegative: false },
          rows: [],
          missingNote: null,
        },
      }),
    );
    renderRoute();
    expect(
      screen.getByTestId("loan-detail-price-collateral-error"),
    ).toHaveTextContent("boom");
  });
});

describe("Loan detail route — still-mock sections", () => {
  it("renders the seven lifecycle statuses (live, from the stepper view-model)", () => {
    renderRoute();
    const lifecycle = screen.getByTestId("loan-detail-lifecycle");
    for (const label of [
      "Origination",
      "Disbursing",
      "Performing",
      "Watchlist",
      "Past Due",
      "Default",
      "Closed",
    ]) {
      expect(within(lifecycle).getByText(label)).toBeInTheDocument();
    }
  });

  it("renders the three summary tiles", () => {
    renderRoute();
    const tiles = screen.getByTestId("loan-detail-tiles");
    expect(within(tiles).getByText("Facility / disbursed")).toBeInTheDocument();
    expect(within(tiles).getByText("Repaid to date")).toBeInTheDocument();
    expect(
      within(tiles).getByText("Interest to distribute"),
    ).toBeInTheDocument();
  });

  it("renders the Registry state & derived rows with source tags", () => {
    renderRoute();
    const reg = screen.getByTestId("loan-detail-registry");
    expect(within(reg).getByText("Status / location")).toBeInTheDocument();
    expect(
      within(reg).getByText("Custodian co-sig on mint"),
    ).toBeInTheDocument();
    expect(within(reg).getAllByText("relayer").length).toBeGreaterThan(0);
  });

  it("renders the current-stage card + primary action", () => {
    renderRoute();
    const stage = screen.getByTestId("loan-detail-current-stage");
    expect(
      within(stage).getByText("Current stage — on-ramp in transit"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("loan-detail-primary-action")).toHaveTextContent(
      "Open on-ramp & mint",
    );
  });

  it("renders the Other actions buttons + timelock note", () => {
    renderRoute();
    const actions = screen.getByTestId("loan-detail-other-actions");
    for (const label of LOAN_DETAIL_MOCK.otherActions.actions) {
      expect(
        within(actions).getByRole("button", { name: label }),
      ).toBeInTheDocument();
    }
    expect(
      within(actions).getByText(/Risk Council proposals under a 24h timelock/),
    ).toBeInTheDocument();
  });
});

describe("Loan detail route — top-level states", () => {
  it("renders the loading skeleton", () => {
    mockUseLoanDetail.mockReturnValue(makeResult({ state: "loading" }));
    renderRoute();
    expect(screen.getByTestId("loan-detail-loading")).toBeInTheDocument();
  });

  it("renders the error alert with a back link", () => {
    mockUseLoanDetail.mockReturnValue(
      makeResult({ state: "error", errorMessage: "kaboom" }),
    );
    renderRoute();
    expect(screen.getByTestId("loan-detail-error")).toHaveTextContent("kaboom");
    expect(screen.getByText("‹ Loans").closest("a")).toHaveAttribute(
      "href",
      "/loans",
    );
  });
});
