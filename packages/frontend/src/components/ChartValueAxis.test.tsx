import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChartValueAxis } from "./ChartValueAxis";

describe("ChartValueAxis", () => {
  it("renders the three labels in top/middle/bottom order", () => {
    render(<ChartValueAxis maxLabel="$23M" midLabel="$12M" bottomLabel="$0" />);
    expect(screen.getByTestId("chart-value-axis-max")).toHaveTextContent(
      "$23M",
    );
    expect(screen.getByTestId("chart-value-axis-mid")).toHaveTextContent(
      "$12M",
    );
    expect(screen.getByTestId("chart-value-axis-bottom")).toHaveTextContent(
      "$0",
    );
  });

  it("distributes the labels with justify-between — the middle tick is fixed, not proportional", () => {
    const { container } = render(
      <ChartValueAxis maxLabel="$100" midLabel="$50" bottomLabel="$0" />,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain("justify-between");
    expect(
      screen.getByTestId("chart-value-axis-mid").getAttribute("style"),
    ).toBeNull();
  });

  it("uses the caption + ink-muted tokens and the 32px column structure", () => {
    const { container } = render(
      <ChartValueAxis maxLabel="$1K" midLabel="$500" bottomLabel="$0" />,
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
});
