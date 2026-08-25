/**
 * Switch — library toggle control (#1158): geometry tokens and toggle behavior.
 * spec: docs/frontend/ui-components.md#switch
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Switch } from "@pipeline/ui";

describe("Switch (#1158)", () => {
  it("renders role=switch with aria-checked and the 52×24 track", () => {
    render(<Switch checked={false} onChange={vi.fn()} />);
    const el = screen.getByRole("switch");
    expect(el).toHaveAttribute("aria-checked", "false");
    expect(el.className).toContain("w-13");
    expect(el.className).toContain("h-6");
    expect(el.className).toContain("bg-[var(--color-pipeline-line)]");
  });

  it("checked state uses the positive-primary track and translates the knob", () => {
    const { container } = render(<Switch checked onChange={vi.fn()} />);
    const el = screen.getByRole("switch");
    expect(el).toHaveAttribute("aria-checked", "true");
    expect(el.className).toContain(
      "bg-[var(--color-pipeline-positive-primary)]",
    );
    const knob = container.querySelector("span[aria-hidden='true']");
    expect(knob?.className).toContain("w-8");
    expect(knob?.className).toContain("h-5");
    expect(knob?.className).toContain("translate-x-4");
  });

  it("click and Space both fire onChange with the flipped value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} />);
    const el = screen.getByRole("switch");
    await user.click(el);
    expect(onChange).toHaveBeenLastCalledWith(true);
    el.focus();
    await user.keyboard(" ");
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
