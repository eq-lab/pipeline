/**
 * Tests for the Audit Log page (`audit-log.tsx`, issue #1004).
 *
 * The presenter hook (`useAuditLogView`, which wraps the query layer) is mocked
 * so these exercise the view: heading, the ready-state table (rows rendered
 * exactly as supplied, truncated reference, resolved scope), and the loading /
 * error / empty branches.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { UseAuditLogView } from "./-useAuditLog";
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
    mockView.mockReturnValue({ state: "ready", errorMessage: null, rows: [] });
    renderRoute();
    expect(
      screen.getByRole("heading", { name: "Audit Log" }),
    ).toBeInTheDocument();
  });

  it("renders a row per served item with resolved scope and truncated reference", () => {
    mockView.mockReturnValue({
      state: "ready",
      errorMessage: null,
      rows: [
        {
          key: "k1",
          time: "24 Jun 07:12",
          action: "Repayment recorded — principal + final interest",
          scopeLabel: "Helios Metals — Lithium",
          reference: "0xabc1…f4d9",
          referenceFull: "0xabc1234567890def4d9",
        },
      ],
    });
    renderRoute();
    expect(screen.getAllByTestId("audit-row")).toHaveLength(1);
    expect(
      screen.getByText("Repayment recorded — principal + final interest"),
    ).toBeInTheDocument();
    expect(screen.getByText("Helios Metals — Lithium")).toBeInTheDocument();
    expect(screen.getByText("0xabc1…f4d9")).toBeInTheDocument();
  });

  it("shows an empty state when there are no rows", () => {
    mockView.mockReturnValue({ state: "ready", errorMessage: null, rows: [] });
    renderRoute();
    expect(screen.getByTestId("audit-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("audit-row")).not.toBeInTheDocument();
  });

  it("shows a loading skeleton while loading", () => {
    mockView.mockReturnValue({
      state: "loading",
      errorMessage: null,
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
      rows: [],
    });
    renderRoute();
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
  });
});
