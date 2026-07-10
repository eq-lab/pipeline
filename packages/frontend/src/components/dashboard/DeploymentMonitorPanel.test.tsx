/**
 * Component tests for `DeploymentMonitorPanel` (issue #755).
 *
 * The data/logic hook `useDeploymentMonitorPanel` is mocked so these tests
 * focus on the view: tab bar interactivity, count badges, and the
 * In-Origination `OriginationTable`'s field set (issue #814).
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
        id: 1,
        originator: "Trafigura",
        commodity: "Alumina",
        facility: "$8,000,000",
        corridor: "West Africa → EU",
        rate: "11.2%",
        maturity: "15 Dec 2026",
        submitted: "18 Jun",
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

describe("DeploymentMonitorPanel — origination content (issue #814 field set)", () => {
  it("renders the Figma 4116-9155 columns with the submission's formatted values when the tab is active", () => {
    hookState = baseState({ activeTab: "origination" });
    render(<DeploymentMonitorPanel />);

    // New 8-column header set.
    for (const header of [
      "Originator",
      "Commodity",
      "Facility",
      "Corridor",
      "Rate",
      "Maturity",
      "Submitted",
      "Status",
    ]) {
      expect(screen.getByText(header)).toBeTruthy();
    }

    const table = screen.getByTestId("origination-table");
    expect(within(table).getByText("Trafigura")).toBeTruthy();
    expect(within(table).getByText("Alumina")).toBeTruthy();
    expect(within(table).getByText("$8,000,000")).toBeTruthy();
    expect(within(table).getByText("West Africa → EU")).toBeTruthy();
    expect(within(table).getByText("15 Dec 2026")).toBeTruthy();
    expect(within(table).getByText("18 Jun")).toBeTruthy();
    expect(within(table).getByText("InReview")).toBeTruthy();
  });

  it("colours the Status cell by lifecycle status", () => {
    const row = {
      id: 1,
      originator: "X",
      commodity: "Y",
      facility: "$1,000,000",
      corridor: "A → B",
      rate: "10.0%",
      maturity: "1 Jan 2027",
      submitted: "1 Jan",
    };
    hookState = baseState({
      activeTab: "origination",
      originationRows: [
        { ...row, originator: "A", status: "Approved" },
        { ...row, originator: "R", status: "Rejected" },
        { ...row, originator: "I", status: "InReview" },
      ],
    });
    render(<DeploymentMonitorPanel />);

    expect(screen.getByText("Approved").className).toContain(
      "var(--color-pipeline-positive)",
    );
    expect(screen.getByText("Rejected").className).toContain(
      "var(--color-pipeline-negative)",
    );
    expect(screen.getByText("InReview").className).toContain(
      "var(--color-pipeline-pending)",
    );
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

  it("does not render the origination Status column on the Active Loans tab", () => {
    render(<DeploymentMonitorPanel />); // activeTab: "active"
    expect(screen.queryByTestId("origination-table")).toBeNull();
    expect(screen.queryByText("Status")).toBeNull();
  });
});
