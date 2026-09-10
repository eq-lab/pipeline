import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChartValueAxis } from "./ChartValueAxis";

describe("ChartValueAxis", () => {
  it("renders the three labels in top/avg/bottom order", () => {
    render(
      <ChartValueAxis
        maxLabel="$23M"
        avgLabel="$18M"
        avgFraction={0.8}
        bottomLabel="$0"
      />,
    );
    expect(screen.getByTestId("chart-value-axis-max")).toHaveTextContent(
      "$23M",
    );
    expect(screen.getByTestId("chart-value-axis-avg")).toHaveTextContent(
      "$18M",
    );
    expect(screen.getByTestId("chart-value-axis-bottom")).toHaveTextContent(
      "$0",
    );
  });

  it("positions the average label proportionally from the top, not at 50%", () => {
    render(
      <ChartValueAxis
        maxLabel="$100"
        avgLabel="$90"
        avgFraction={0.9}
        bottomLabel="$0"
      />,
    );
    const avg = screen.getByTestId("chart-value-axis-avg");
    expect(avg.style.top).toBe("10%");
  });

  it("uses the caption + ink-muted tokens and the 32px column structure", () => {
    const { container } = render(
      <ChartValueAxis
        maxLabel="$1K"
        avgLabel="$500"
        avgFraction={0.5}
        bottomLabel="$0"
      />,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain("w-[32px]");
    const max = screen.getByTestId("chart-value-axis-max");
    expect(max.className).toContain(
      "text-[length:var(--text-pipeline-caption)]",
    );
    expect(max.className).toContain(
      "text-[color:var(--color-pipeline-ink-muted)]",
    );
  });

  it("renders '—' for a missing average without throwing", () => {
    render(
      <ChartValueAxis
        maxLabel="$23M"
        avgLabel="—"
        avgFraction={0.5}
        bottomLabel="$0"
      />,
    );
    expect(screen.getByTestId("chart-value-axis-avg")).toHaveTextContent("—");
  });
});
