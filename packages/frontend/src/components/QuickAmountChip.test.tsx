/**
 * Unit tests for QuickAmountChip — Issue #595 styling fixes.
 *
 * Asserts the corrected visual classes after fix 5:
 *   - Pill radius (`--radius-pipeline-pill`) instead of button radius
 *   - No border class
 *   - Caption font size (`--text-pipeline-caption`) instead of body
 *   - Regular weight (`--font-weight-regular`) instead of emphasized
 *   - Primary ink colour (`--color-pipeline-ink`) for unselected chips
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { QuickAmountChip } from "@pipeline/ui";

describe("QuickAmountChip — styling (fix 5, Issue #595)", () => {
  it("uses pill radius class (--radius-pipeline-pill)", () => {
    const { container } = render(<QuickAmountChip label="Max" />);
    const btn = container.querySelector("button");
    expect(btn?.className).toContain("--radius-pipeline-pill");
    expect(btn?.className).not.toContain("--radius-pipeline-button");
  });

  it("has no border class", () => {
    const { container } = render(<QuickAmountChip label="Max" />);
    const btn = container.querySelector("button");
    // Should not have a border utility (e.g. "border border-[...]")
    expect(btn?.className).not.toMatch(/\bborder\b(?!\s*-0)/);
  });

  it("uses caption font size (--text-pipeline-caption)", () => {
    const { container } = render(<QuickAmountChip label="$1,000 (Min)" />);
    const btn = container.querySelector("button");
    expect(btn?.className).toContain("--text-pipeline-caption");
    expect(btn?.className).not.toContain("--text-pipeline-body");
  });

  it("uses regular font weight (--font-weight-regular)", () => {
    const { container } = render(<QuickAmountChip label="$5,000" />);
    const btn = container.querySelector("button");
    expect(btn?.className).toContain("--font-weight-regular");
    expect(btn?.className).not.toContain("--font-weight-emphasized");
  });

  it("unselected chip uses primary ink colour (--color-pipeline-ink)", () => {
    const { container } = render(
      <QuickAmountChip label="Max" selected={false} />,
    );
    const btn = container.querySelector("button");
    expect(btn?.className).toContain("--color-pipeline-ink");
  });

  it("selected chip still uses primary ink colour (--color-pipeline-ink)", () => {
    const { container } = render(
      <QuickAmountChip label="Max" selected={true} />,
    );
    const btn = container.querySelector("button");
    expect(btn?.className).toContain("--color-pipeline-ink");
  });

  it("onClick fires when chip is clicked", async () => {
    const onClick = vi.fn();
    const { container } = render(
      <QuickAmountChip label="Max" onClick={onClick} />,
    );
    const btn = container.querySelector("button") as HTMLButtonElement;
    btn.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("disabled chip does not fire onClick", () => {
    const onClick = vi.fn();
    const { container } = render(
      <QuickAmountChip label="Max" onClick={onClick} disabled />,
    );
    const btn = container.querySelector("button") as HTMLButtonElement;
    btn.click();
    expect(onClick).not.toHaveBeenCalled();
  });
});
