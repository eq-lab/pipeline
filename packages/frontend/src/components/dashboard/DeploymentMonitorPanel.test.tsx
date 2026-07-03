/**
 * Component tests for `DeploymentMonitorPanel` (issue #755).
 *
 * The data/logic hook `useDeploymentMonitorPanel` is mocked so these tests
 * focus on the view: tab bar interactivity, count badges, and the origination
 * table's Status column.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { DeploymentMonitorPanel } from "./DeploymentMonitorPanel";
import type { DeploymentMonitorPanelState } from "./useDeploymentMonitorPanel";

const setActiveTab = vi.fn();
let hookState: DeploymentMonitorPanelState;

vi.mock("./useDeploymentMonitorPanel", () => ({
  useDeploymentMonitorPanel: () => hookState,
}));

function baseState(
  overrides: Partial<DeploymentMonitorPanelState> = {},
): DeploymentMonitorPanelState {
  return {
    state: "ready",
    summary: {
      totalDeployed: "$31.6M",
      totalCollateral: "—",
      seniorDebtCoverage: "—",
      avgYield: "11.2%",
      avgDuration: "68 days",
    },
    rows: [
      {
        borrowerCommodity: "Open Mineral / Copper Concentrate",
        principal: "$8.0M",
        collateral: "—",
        ltv: "—",
        duration: "120d",
        rate: "11.2%",
        protection: "LC at sight",
      },
    ],
    headerAggregates: { principal: "$31.6M" },
    activeLoansCount: 7,
    errorMessage: undefined,
    refetch: vi.fn(),
    activeTab: "active",
    setActiveTab,
    originationRows: [
      {
        borrowerCommodity: "Trafigura / Alumina",
        principal: "$8.0M",
        collateral: "—",
        ltv: "85%",
        duration: "120d",
        rate: "11.2%",
        protection: "LC at sight",
        status: "InReview",
      },
    ],
    inOriginationCount: 3,
    originationState: "ready",
    originationErrorMessage: undefined,
    refetchOrigination: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  setActiveTab.mockClear();
  hookState = baseState();
});

describe("DeploymentMonitorPanel — tab bar", () => {
  it("renders both count badges", () => {
    render(<DeploymentMonitorPanel />);
    expect(
      screen.getByTestId("loan-book-tab-active-loans-count").textContent,
    ).toBe("7");
    expect(
      screen.getByTestId("loan-book-tab-in-origination-count").textContent,
    ).toBe("3");
  });

  it("In Origination tab is selectable (not disabled)", () => {
    render(<DeploymentMonitorPanel />);
    const tab = screen.getByTestId("loan-book-tab-in-origination");
    expect(tab.getAttribute("aria-disabled")).toBeNull();
    expect(tab.getAttribute("aria-selected")).toBe("false");
  });

  it("selects the In Origination tab on click", () => {
    render(<DeploymentMonitorPanel />);
    fireEvent.click(screen.getByTestId("loan-book-tab-in-origination"));
    expect(setActiveTab).toHaveBeenCalledWith("origination");
  });
});

describe("DeploymentMonitorPanel — origination content", () => {
  it("renders the Status column with the submission status when the tab is active", () => {
    hookState = baseState({ activeTab: "origination" });
    render(<DeploymentMonitorPanel />);

    // Status header present in the origination table.
    expect(screen.getByText("Status")).toBeTruthy();
    const table = screen.getByTestId("loan-book-table");
    expect(within(table).getByText("InReview")).toBeTruthy();
    expect(within(table).getByText("Trafigura / Alumina")).toBeTruthy();
  });

  it("shows an empty state when there are no submissions", () => {
    hookState = baseState({
      activeTab: "origination",
      originationState: "empty",
      originationRows: [],
      inOriginationCount: 0,
    });
    render(<DeploymentMonitorPanel />);
    expect(screen.getByTestId("loan-book-origination-empty")).toBeTruthy();
  });

  it("does not render the Status column on the Active Loans tab", () => {
    render(<DeploymentMonitorPanel />); // activeTab: "active"
    expect(screen.queryByText("Status")).toBeNull();
  });
});
