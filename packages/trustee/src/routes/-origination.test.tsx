/**
 * Tests for the real Origination route (issue #813) — the page heading, the
 * submissions table (all three statuses), loading / error / empty states,
 * and "—" for a missing field. The Figma static footer note is deliberately
 * NOT rendered (human review follow-up on this issue) — see the "does not
 * render the Figma footer note" test below. Mocks `useOriginationTable` (the
 * field-mapping and query-state hook) so the view is exercised as a pure
 * render function, per `docs/FRONTEND.md` rule 2.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Route } from "./origination";
import { useOriginationTable } from "./-useOriginationTable";
import type {
  OriginationTableRow,
  UseOriginationTableResult,
} from "./-useOriginationTable";

vi.mock("./-useOriginationTable", async () => {
  const actual = await vi.importActual<typeof import("./-useOriginationTable")>(
    "./-useOriginationTable",
  );
  return {
    ...actual,
    useOriginationTable: vi.fn(),
  };
});

function mockTable(result: UseOriginationTableResult) {
  vi.mocked(useOriginationTable).mockReturnValue(result);
}

function renderRoute() {
  const Page = Route.options.component as React.ComponentType;
  return render(<Page />);
}

const APPROVED_ROW: OriginationTableRow = {
  id: 2,
  originator: "Helios Metals",
  commodity: "Lithium carbonate",
  facility: "$6,000,000",
  corridor: "CL → KR",
  rate: "13.0%",
  maturity: "30 Jun 2026",
  submitted: "2 Jan",
  status: { kind: "approved", label: "Approved & minted · 2 Jan" },
};

const IN_REVIEW_ROW: OriginationTableRow = {
  id: 1,
  originator: "Auric Andes",
  commodity: "Gold pyrite concentrate",
  facility: "$3,500,000",
  corridor: "PE → CN",
  rate: "14.0%",
  maturity: "15 Dec 2026",
  submitted: "18 Jun",
  status: { kind: "in-review", label: "Review" },
};

const REJECTED_ROW: OriginationTableRow = {
  id: 3,
  originator: "Delta Ore",
  commodity: "Copper cathode",
  facility: "$1,200,000",
  corridor: "CL → US",
  rate: "11.5%",
  maturity: "1 Mar 2027",
  submitted: "5 May",
  status: {
    kind: "rejected",
    label: "Rejected",
    reason: "Missing export permit",
  },
};

const MISSING_FIELD_ROW: OriginationTableRow = {
  id: 4,
  originator: "—",
  commodity: "—",
  facility: "—",
  corridor: "—",
  rate: "—",
  maturity: "—",
  submitted: "—",
  status: { kind: "unknown", label: "—" },
};

describe("Origination route", () => {
  it("renders without throwing", () => {
    mockTable({ state: "empty", errorMessage: null, rows: [] });
    expect(() => renderRoute()).not.toThrow();
  });

  it("shows the Origination heading", () => {
    mockTable({ state: "empty", errorMessage: null, rows: [] });
    renderRoute();
    expect(
      screen.getByRole("heading", { name: "Origination" }),
    ).toBeInTheDocument();
  });

  it("does not render the Figma footer note (deliberately omitted)", () => {
    mockTable({ state: "empty", errorMessage: null, rows: [] });
    renderRoute();
    expect(
      screen.queryByTestId("origination-footer-note"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/document set adapts to the commodity/),
    ).not.toBeInTheDocument();
  });

  it("renders a loading skeleton", () => {
    mockTable({ state: "loading", errorMessage: null, rows: [] });
    renderRoute();
    expect(screen.getByTestId("origination-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("origination-table")).not.toBeInTheDocument();
  });

  it("renders an inline error surface", () => {
    mockTable({
      state: "error",
      errorMessage: "Failed to fetch",
      rows: [],
    });
    renderRoute();
    const alert = screen.getByTestId("origination-error");
    expect(alert).toBeInTheDocument();
    expect(alert.textContent).toContain("Failed to fetch");
  });

  it("renders an empty-state caption", () => {
    mockTable({ state: "empty", errorMessage: null, rows: [] });
    renderRoute();
    expect(screen.getByTestId("origination-empty").textContent).toBe(
      "No loans in origination.",
    );
  });

  it("renders table rows for each status: Approved, InReview, Rejected", () => {
    mockTable({
      state: "ready",
      errorMessage: null,
      rows: [IN_REVIEW_ROW, APPROVED_ROW, REJECTED_ROW],
    });
    renderRoute();

    expect(screen.getAllByTestId("origination-row")).toHaveLength(3);

    // InReview -> inert Review button.
    const reviewButton = screen.getByTestId("origination-status-review");
    expect(reviewButton).toBeDisabled();
    expect(reviewButton).toHaveTextContent("Review");

    // Approved -> green pill with the mint date.
    expect(screen.getByTestId("origination-status-approved")).toHaveTextContent(
      "Approved & minted · 2 Jan",
    );

    // Rejected -> red pill with the reason available on hover (title attr).
    const rejectedPill = screen.getByTestId("origination-status-rejected");
    expect(rejectedPill).toHaveTextContent("Rejected");
    expect(rejectedPill).toHaveAttribute("title", "Missing export permit");
  });

  it("does not render a valuation sub-line under the commodity", () => {
    mockTable({ state: "ready", errorMessage: null, rows: [APPROVED_ROW] });
    renderRoute();
    expect(screen.queryByText(/NSR/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Standard · price/)).not.toBeInTheDocument();
  });

  it("renders '—' for missing fields rather than fabricating a value", () => {
    mockTable({
      state: "ready",
      errorMessage: null,
      rows: [MISSING_FIELD_ROW],
    });
    renderRoute();
    const row = screen.getByTestId("origination-row");
    expect(row.textContent).toContain("—");
    expect(screen.getByTestId("origination-status-unknown")).toHaveTextContent(
      "—",
    );
  });
});
