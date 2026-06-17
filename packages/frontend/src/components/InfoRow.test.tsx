/**
 * Unit tests for InfoRow — Issue #595 styling fixes.
 *
 * Asserts fix 7:
 *   - Body font size classes (--text-pipeline-body) on both label and value.
 *   - The info-row-network-fee derived testid still resolves.
 *   - The info-row-exchange-rate derived testid also resolves (all rows changed).
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { InfoRow } from "@pipeline/ui";

describe("InfoRow — body font (fix 7, Issue #595)", () => {
  it("label uses body font size token (--text-pipeline-body)", () => {
    const { container } = render(
      <InfoRow label="Network fee" value="~$1.20" />,
    );
    const spans = container.querySelectorAll("span");
    const labelSpan = spans[0] as HTMLSpanElement;
    expect(labelSpan.className).toContain("--text-pipeline-body");
    expect(labelSpan.className).not.toContain("--text-pipeline-caption");
  });

  it("value uses body font size token (--text-pipeline-body)", () => {
    const { container } = render(
      <InfoRow label="Network fee" value="~$1.20" />,
    );
    const spans = container.querySelectorAll("span");
    const valueSpan = spans[1] as HTMLSpanElement;
    expect(valueSpan.className).toContain("--text-pipeline-body");
    expect(valueSpan.className).not.toContain("--text-pipeline-caption");
  });

  it("info-row-network-fee testid resolves", () => {
    render(<InfoRow label="Network fee" value="~$1.20" />);
    expect(screen.getByTestId("info-row-network-fee")).toBeInTheDocument();
  });

  it("info-row-exchange-rate testid resolves", () => {
    render(<InfoRow label="Exchange rate" value="1 USDC = 1 PLUSD" />);
    expect(screen.getByTestId("info-row-exchange-rate")).toBeInTheDocument();
  });
});
