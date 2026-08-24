/**
 * Tests for `EarnedCard` — value color keys off the rendered sign (#1194).
 * spec: docs/frontend/dashboard-components.md#earnedcard
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EarnedCard } from "./EarnedCard";

const GREEN = "text-[color:var(--color-pipeline-chart-positive)]";
const INK = "text-[color:var(--color-pipeline-ink)]";
const SUBTLE = "text-[color:var(--color-pipeline-ink-subtle)]";

describe("EarnedCard value color (#1194)", () => {
  it("renders a positive PnL label in the green positive token", () => {
    render(<EarnedCard earnedPnlLabel="+$123.00" />);
    const value = screen.getByTestId("home-earned-value");
    expect(value).toHaveTextContent("+$123.00");
    expect(value.className).toContain(GREEN);
  });

  it("renders a zero PnL label in primary ink, not green", () => {
    render(<EarnedCard earnedPnlLabel="$0.00" />);
    const value = screen.getByTestId("home-earned-value");
    expect(value.className).not.toContain(GREEN);
    expect(value.className).toContain(INK);
  });

  it("renders a negative PnL label in primary ink, not green", () => {
    render(<EarnedCard earnedPnlLabel="-$3.00" />);
    const value = screen.getByTestId("home-earned-value");
    expect(value.className).not.toContain(GREEN);
    expect(value.className).toContain(INK);
  });

  it("renders the placeholder in subtle ink when no label is present", () => {
    render(<EarnedCard />);
    const value = screen.getByTestId("home-earned-value");
    expect(value).toHaveTextContent("Tracked once you stake");
    expect(value.className).toContain(SUBTLE);
  });
});
