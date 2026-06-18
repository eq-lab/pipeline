/**
 * Unit tests for QuickAmountChip — Issue #595 styling fixes, updated Issue #614.
 *
 * Asserts the corrected visual classes after fix 5 (Issue #595) and bug fix (Issue #614):
 *   - 4px card radius (`--radius-pipeline-card`) instead of full pill radius
 *   - No border class
 *   - Caption font size (`--text-pipeline-caption`) instead of body
 *   - Regular weight (`--font-weight-regular`) instead of emphasized
 *   - Primary ink colour (`--color-pipeline-ink`) for unselected chips
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { QuickAmountChip } from "@pipeline/ui";

describe("QuickAmountChip — styling (fix 5, Issue #595)", () => {
  it("uses 4px card radius class (--radius-pipeline-card) per Issue #614", () => {
    const { container } = render(<QuickAmountChip label="Max" />);
    const btn = container.querySelector("button");
    expect(btn?.className).toContain("--radius-pipeline-card");
    expect(btn?.className).not.toContain("--radius-pipeline-pill");
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
