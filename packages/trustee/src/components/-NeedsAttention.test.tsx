/**
 * Render tests for `NeedsAttention.tsx` — the Overview page's Needs
 * Attention section, Origination group ONLY (issue #818).
 *
 * Covers:
 *   - Renders the "Needs Attention" heading + "Origination" group header +
 *     one row per in-review submission, with the expected title/subtitle.
 *   - Renders nothing (no heading, `queryByTestId("needs-attention")` null)
 *     when there are no in-review submissions (empty state).
 *   - Renders nothing on loading/error (supplementary block, not primary
 *     content — resolved default per the exec plan).
 *   - The "Review" button is present, disabled, and has the accessible
 *     label / aria-disabled (inert, not wired).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NeedsAttention } from "./NeedsAttention";
import type { UseNeedsAttentionResult } from "./useNeedsAttention";

const mockUseNeedsAttention = vi.fn<() => UseNeedsAttentionResult>();

vi.mock("./useNeedsAttention", () => ({
  useNeedsAttention: () => mockUseNeedsAttention(),
}));

describe("NeedsAttention", () => {
  it("renders the heading, group header, and one row per in-review submission", () => {
    mockUseNeedsAttention.mockReturnValue({
      state: "ready",
      errorMessage: null,
      rows: [
        {
          id: 1,
          title: "Open Mineral — Copper Concentrate: new request",
          subtitle: "Copper Concentrate · PE → CN · submitted 18 Jun",
        },
      ],
    });

    render(<NeedsAttention />);

    expect(
      screen.getByRole("heading", { name: "Needs Attention" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Origination")).toBeInTheDocument();
    expect(screen.getByTestId("needs-attention")).toBeInTheDocument();
    expect(
      screen.getByTestId("needs-attention-origination"),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("needs-attention-row")).toHaveLength(1);
    expect(
      screen.getByText("Open Mineral — Copper Concentrate: new request"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Copper Concentrate · PE → CN · submitted 18 Jun"),
    ).toBeInTheDocument();
  });

  it("renders one row per in-review submission when there are multiple", () => {
    mockUseNeedsAttention.mockReturnValue({
      state: "ready",
      errorMessage: null,
      rows: [
        {
          id: 1,
          title: "Open Mineral — Copper Concentrate: new request",
          subtitle: "Copper Concentrate · PE → CN · submitted 18 Jun",
        },
        {
          id: 2,
          title: "Auric Andes — Gold Pyrite Concentrate: new request",
          subtitle: "Gold Pyrite Concentrate · submitted 20 Jun",
        },
      ],
    });

    render(<NeedsAttention />);
    expect(screen.getAllByTestId("needs-attention-row")).toHaveLength(2);
  });

  it("renders the Review button as disabled/inert with an accessible label", () => {
    mockUseNeedsAttention.mockReturnValue({
      state: "ready",
      errorMessage: null,
      rows: [
        {
          id: 1,
          title: "Open Mineral — Copper Concentrate: new request",
          subtitle: "Copper Concentrate · PE → CN · submitted 18 Jun",
        },
      ],
    });

    render(<NeedsAttention />);

    const button = screen.getByTestId("needs-attention-review");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAccessibleName(
      "Review submission (not yet available)",
    );
    expect(button).toHaveTextContent("Review");
  });

  it("renders nothing (whole section absent) when state is 'empty'", () => {
    mockUseNeedsAttention.mockReturnValue({
      state: "empty",
      errorMessage: null,
      rows: [],
    });

    render(<NeedsAttention />);

    expect(screen.queryByTestId("needs-attention")).not.toBeInTheDocument();
    expect(screen.queryByText("Needs Attention")).not.toBeInTheDocument();
    expect(screen.queryByText("Origination")).not.toBeInTheDocument();
  });

  it("renders nothing while loading (no skeleton — supplementary block)", () => {
    mockUseNeedsAttention.mockReturnValue({
      state: "loading",
      errorMessage: null,
      rows: [],
    });

    render(<NeedsAttention />);

    expect(screen.queryByTestId("needs-attention")).not.toBeInTheDocument();
  });

  it("renders nothing on error (omits the section rather than showing an error surface)", () => {
    mockUseNeedsAttention.mockReturnValue({
      state: "error",
      errorMessage: "network down",
      rows: [],
    });

    render(<NeedsAttention />);

    expect(screen.queryByTestId("needs-attention")).not.toBeInTheDocument();
  });
});
