/**
 * Logo — unit tests (Issue #579).
 *
 * Covers:
 *   - Default color is brand navy (inline style carries the CSS variable).
 *   - Caller can override color to white via style prop.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Logo } from "@pipeline/ui";

describe("Logo — color override", () => {
  it("renders with default brand-navy CSS variable as inline style color", () => {
    const { container } = render(<Logo />);
    const svg = container.querySelector(
      'svg[aria-label="Pipeline"]',
    ) as SVGSVGElement | null;
    expect(svg).not.toBeNull();
    // Default: inline style color is the CSS variable token (navy).
    // jsdom does not resolve CSS variables, so we assert the raw style value.
    expect(svg!.style.color).toBe("var(--color-pipeline-brand)");
  });

  it("caller style prop overrides the default navy — white wins", () => {
    const { container } = render(<Logo style={{ color: "#fff" }} />);
    const svg = container.querySelector(
      'svg[aria-label="Pipeline"]',
    ) as SVGSVGElement | null;
    expect(svg).not.toBeNull();
    // The ...style spread in composedStyle lets caller color take precedence.
    // jsdom normalizes #fff to rgb(255, 255, 255).
    expect(svg!.style.color).toBe("rgb(255, 255, 255)");
  });
});
