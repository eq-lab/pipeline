/**
 * Render tests for the Loan detail route (`loans.$id.tsx`, issue #847) — the
 * full-design MOCK build. Renders every section from the static fixture
 * (`-loanDetailMock.ts`) and asserts the Figma copy is present. `Link` is
 * mocked and `Route.useParams` patched (no real router tree), mirroring
 * `-origination-detail-page.test.tsx`.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

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

import { Route } from "./loans.$id";
import { LOAN_DETAIL_MOCK } from "./-loanDetailMock";

function renderRoute() {
  const Page = Route.options.component as React.ComponentType;
  return render(<Page />);
}

describe("Loan detail route (mock)", () => {
  it("renders the hero (title, status chip, meta)", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { name: LOAN_DETAIL_MOCK.hero.title }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("loan-detail-status-chip")).toHaveTextContent(
      "Performing",
    );
    expect(screen.getByTestId("loan-detail-meta")).toHaveTextContent(
      LOAN_DETAIL_MOCK.hero.meta,
    );
  });

  it("renders all six deal-journey stages", () => {
    renderRoute();
    const journey = screen.getByTestId("loan-detail-journey");
    for (const stage of LOAN_DETAIL_MOCK.journey) {
      expect(within(journey).getByText(stage.label)).toBeInTheDocument();
    }
    expect(within(journey).getByText("in transit")).toBeInTheDocument();
  });

  it("renders the three summary tiles", () => {
    renderRoute();
    const tiles = screen.getByTestId("loan-detail-tiles");
    expect(within(tiles).getByText("Facility / disbursed")).toBeInTheDocument();
    expect(within(tiles).getByText("$4.8M / $4.8M")).toBeInTheDocument();
    expect(within(tiles).getByText("Repaid to date")).toBeInTheDocument();
    expect(
      within(tiles).getByText("Interest to distribute"),
    ).toBeInTheDocument();
  });

  it("renders the Price & collateral rows + footnote", () => {
    renderRoute();
    const pc = screen.getByTestId("loan-detail-price-collateral");
    expect(within(pc).getByText("Spot (off-chain API)")).toBeInTheDocument();
    expect(within(pc).getByText("−1.2% 7d")).toBeInTheDocument();
    expect(within(pc).getByText("620 t")).toBeInTheDocument();
    expect(within(pc).getByText("$5,831,100")).toBeInTheDocument();
    expect(within(pc).getByText("n/a — price risk closed")).toBeInTheDocument();
    expect(within(pc).getByText(/Last on-chain write/)).toBeInTheDocument();
  });

  it("renders the Registry state & derived rows with source tags", () => {
    renderRoute();
    const reg = screen.getByTestId("loan-detail-registry");
    expect(within(reg).getByText("Status / location")).toBeInTheDocument();
    expect(
      within(reg).getByText("Performing · MV Andes, IMO 9741205"),
    ).toBeInTheDocument();
    expect(
      within(reg).getByText("Custodian co-sig on mint"),
    ).toBeInTheDocument();
    expect(within(reg).getByText("awaiting USDC")).toBeInTheDocument();
    // Source tag rendered.
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

  it("has a back link to /loans", () => {
    renderRoute();
    expect(screen.getByText("‹ Loans").closest("a")).toHaveAttribute(
      "href",
      "/loans",
    );
  });
});
