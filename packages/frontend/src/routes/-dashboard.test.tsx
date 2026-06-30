/**
 * Integration tests for the /dashboard route (Issue #716).
 *
 * The Protocol Dashboard is protocol-wide and pulls no wallet/API hooks, so —
 * unlike `-transactions.test.tsx` / `-index.test.tsx` — no wagmi/AppKit mocks
 * are needed. We render the route's `component` directly and assert the shell,
 * the four placeholder panels, the responsive grid classes, and the reusable
 * loading/empty/error state presentations.
 *
 * Scenarios covered:
 *   1. Page root + <main> render (protocol-wide; no wallet connected, no gate).
 *   2. All four panel containers render with their titles.
 *   3. Responsive structure: grid is single-column on mobile, two-column at md+.
 *   4. PanelLoading shows loading copy.
 *   5. PanelEmpty shows its caption.
 *   6. PanelError's Retry button invokes onRetry.
 */
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route } from "./dashboard";
import { PanelLoading } from "@/components/dashboard/PanelLoading";
import { PanelEmpty } from "@/components/dashboard/PanelEmpty";
import { PanelError } from "@/components/dashboard/PanelError";

function renderDashboard() {
  const DashboardPage = Route.options.component as React.ComponentType;
  return render(<DashboardPage />);
}

describe("/dashboard route shell", () => {
  it("renders the page root and <main> with no wallet connected", () => {
    renderDashboard();
    expect(screen.getByTestId("dashboard-page-root")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-main")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-title")).toHaveTextContent(
      "Protocol Dashboard",
    );
  });

  it("renders all four placeholder panels with their titles", () => {
    renderDashboard();
    const expected: Array<[string, string]> = [
      ["dashboard-panel-balance-sheet", "Balance Sheet"],
      ["dashboard-panel-deployment-monitor", "Deployment Monitor"],
      ["dashboard-panel-withdrawal-queue", "Withdrawal Queue"],
      ["dashboard-panel-yield-history", "Yield History"],
    ];
    for (const [testId, title] of expected) {
      const panel = screen.getByTestId(testId);
      expect(panel).toBeInTheDocument();
      expect(panel).toHaveTextContent(title);
    }
    // Each placeholder renders the shared empty body.
    expect(screen.getAllByText("Coming soon")).toHaveLength(4);
  });

  it("lays out a responsive grid: single column on mobile, two columns at md+", () => {
    renderDashboard();
    const grid = screen.getByTestId("dashboard-grid");
    expect(grid.className).toContain("grid-cols-1");
    expect(grid.className).toContain("md:grid-cols-2");
  });
});

describe("dashboard panel state presentations", () => {
  it("PanelLoading shows loading copy", () => {
    render(<PanelLoading />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("PanelEmpty shows its caption", () => {
    render(<PanelEmpty caption="Coming soon" />);
    expect(screen.getByText("Coming soon")).toBeInTheDocument();
  });

  it("PanelError renders a message and invokes onRetry when Retry is clicked", async () => {
    const onRetry = vi.fn();
    render(<PanelError onRetry={onRetry} message="Couldn’t load this panel" />);
    expect(screen.getByText("Couldn’t load this panel")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
