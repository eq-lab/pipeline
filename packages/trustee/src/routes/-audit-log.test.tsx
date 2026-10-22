/**
 * Tests for the Audit Log page (`audit-log.tsx`, issue #1004).
 *
 * The presenter hook (`useAuditLogView`, which wraps the query layer) is mocked
 * so these exercise the view: heading, the ready-state table (rows rendered
 * exactly as supplied, chain label, full loan-name reference, resolved scope), and the loading /
 * error / empty branches.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { AuditRow, UseAuditLogView } from "./-useAuditLog";
import { Route } from "./audit-log";

const mockView = vi.fn<() => UseAuditLogView>();

vi.mock("./-useAuditLog", () => ({
  useAuditLogView: () => mockView(),
}));

function renderRoute() {
  const Page = Route.options.component as React.ComponentType;
  return render(<Page />);
}

beforeEach(() => {
  mockView.mockReset();
});

describe("Audit Log page", () => {
  it("shows the Audit Log heading", () => {
    mockView.mockReturnValue({
      state: "ready",
      errorMessage: null,
      errorDetails: null,
      rows: [],
    });
    renderRoute();
    expect(
      screen.getByRole("heading", { name: "Audit Log" }),
    ).toBeInTheDocument();
  });

  it("renders a row per served item with its chain, resolved scope and the full loan-name reference (#1599)", () => {
    mockView.mockReturnValue({
      state: "ready",
      errorMessage: null,
      errorDetails: null,
      rows: [
        {
          key: "k1",
          time: "24 Jun 07:12",
          chain: "Hoodi",
          action: "Repayment recorded — principal + final interest",
          scopeLabel: "Loan #7",
          reference: "Open Mineral — Copper Concentrate",
        },
      ],
    });
    renderRoute();
    const headers = screen
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    expect(headers).toEqual([
      "Time",
      "Chain",
      "Action",
      "Loan / scope",
      "Reference",
    ]);
    expect(screen.getAllByTestId("audit-row")).toHaveLength(1);
    expect(screen.getByTestId("audit-chain-cell")).toHaveTextContent("Hoodi");
    expect(
      screen.getByText("Repayment recorded — principal + final interest"),
    ).toBeInTheDocument();
    expect(screen.getByText("Loan #7")).toBeInTheDocument();
    expect(screen.getByTestId("audit-reference-cell")).toHaveTextContent(
      "Open Mineral — Copper Concentrate",
    );
  });

  it("shows an empty state when there are no rows", () => {
    mockView.mockReturnValue({
      state: "ready",
      errorMessage: null,
      errorDetails: null,
      rows: [],
    });
    renderRoute();
    expect(screen.getByTestId("audit-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("audit-row")).not.toBeInTheDocument();
  });

  it("shows a loading skeleton while loading", () => {
    mockView.mockReturnValue({
      state: "loading",
      errorMessage: null,
      errorDetails: null,
      rows: [],
    });
    renderRoute();
    expect(screen.getByTestId("audit-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("audit-table")).not.toBeInTheDocument();
  });

  it("shows an error message on failure", () => {
    mockView.mockReturnValue({
      state: "error",
      errorMessage: "boom",
      errorDetails: null,
      rows: [],
    });
    renderRoute();
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
  });

  it("caps rendered rows at the page size and reveals more on click", () => {
    const rows: AuditRow[] = Array.from({ length: 120 }, (_, i) => ({
      key: `k${i}`,
      time: "24 Jun 07:12",
      action: `Action ${i}`,
      chain: "Stellar",
      scopeLabel: "Protocol",
      reference: "—",
    }));
    mockView.mockReturnValue({
      state: "ready",
      errorMessage: null,
      errorDetails: null,
      rows,
    });
    renderRoute();

    // First paint caps the DOM at the page size (50), not all 120 rows.
    expect(screen.getAllByTestId("audit-row")).toHaveLength(50);
    const showMore = screen.getByTestId("audit-show-more");
    expect(showMore).toHaveTextContent("Show older (70 more)");

    // Each click reveals another page.
    fireEvent.click(showMore);
    expect(screen.getAllByTestId("audit-row")).toHaveLength(100);
    fireEvent.click(screen.getByTestId("audit-show-more"));
    expect(screen.getAllByTestId("audit-row")).toHaveLength(120);
    // Fully revealed — the control disappears.
    expect(screen.queryByTestId("audit-show-more")).not.toBeInTheDocument();
  });
});
