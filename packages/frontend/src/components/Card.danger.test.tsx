/**
 * Card danger variant — regression tests (Issue #357).
 *
 * Guards against the Tailwind v4 equal-specificity bug where caller-appended
 * bg-[var(--color-pipeline-danger)] classes lose to the white variant's
 * bg-[var(--color-pipeline-surface)] rule, rendering banners invisible.
 *
 * The fix: a first-class `danger` variant whose Tailwind classes are set in
 * the variant map (not appended via className) so there is no competing
 * same-specificity rule from baseClasses.
 *
 * Test strategy:
 *   1. The `danger` variant is accepted by CardVariant (type-level — caught by TS).
 *   2. The rendered element carries data-variant="danger".
 *   3. The rendered element's className includes the danger background and
 *      border token classes but NOT the surface (white) background class.
 *   4. The rendered element's className includes the on-danger text color class.
 *   5. Other variants (white, yellow, muted) still carry the ink text color and
 *      do NOT include the danger background class — no regression.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Card } from "@pipeline/ui";

// ── Group 1: danger variant structural tests ──────────────────────────────────

describe("Card danger variant", () => {
  it("renders without throwing", () => {
    expect(() =>
      render(<Card variant="danger">Error banner</Card>),
    ).not.toThrow();
  });

  it("sets data-variant='danger' on the root element", () => {
    const { container } = render(<Card variant="danger">Error banner</Card>);
    const div = container.querySelector("div");
    expect(div?.getAttribute("data-variant")).toBe("danger");
  });

  it("className includes the danger background token class", () => {
    const { container } = render(<Card variant="danger">Error banner</Card>);
    const div = container.querySelector("div");
    expect(div?.className).toContain("bg-[var(--color-pipeline-danger)]");
  });

  it("className includes the on-danger text color class", () => {
    const { container } = render(<Card variant="danger">Error banner</Card>);
    const div = container.querySelector("div");
    expect(div?.className).toContain(
      "text-[color:var(--color-pipeline-on-danger)]",
    );
  });

  it("className does NOT include the surface (white) background class", () => {
    const { container } = render(<Card variant="danger">Error banner</Card>);
    const div = container.querySelector("div");
    expect(div?.className).not.toContain("bg-[var(--color-pipeline-surface)]");
  });

  it("className includes the danger border color class", () => {
    const { container } = render(<Card variant="danger">Error banner</Card>);
    const div = container.querySelector("div");
    expect(div?.className).toContain(
      "border-[color:var(--color-pipeline-danger)]",
    );
  });

  it("renders children", () => {
    const { getByText } = render(
      <Card variant="danger">Contract Unreachable</Card>,
    );
    expect(getByText("Contract Unreachable")).toBeInTheDocument();
  });
});

// ── Group 2: no regression on other variants ──────────────────────────────────

describe("Card white/yellow/muted variants — no regression", () => {
  it("white variant does not include danger background class", () => {
    const { container } = render(<Card variant="white">Content</Card>);
    const div = container.querySelector("div");
    expect(div?.className).not.toContain("bg-[var(--color-pipeline-danger)]");
  });

  it("white variant includes ink text color class", () => {
    const { container } = render(<Card variant="white">Content</Card>);
    const div = container.querySelector("div");
    expect(div?.className).toContain("text-[color:var(--color-pipeline-ink)]");
  });

  it("yellow variant does not include danger background class", () => {
    const { container } = render(<Card variant="yellow">Content</Card>);
    const div = container.querySelector("div");
    expect(div?.className).not.toContain("bg-[var(--color-pipeline-danger)]");
  });

  it("yellow variant includes ink text color class", () => {
    const { container } = render(<Card variant="yellow">Content</Card>);
    const div = container.querySelector("div");
    expect(div?.className).toContain("text-[color:var(--color-pipeline-ink)]");
  });

  it("muted variant does not include danger background class", () => {
    const { container } = render(<Card variant="muted">Content</Card>);
    const div = container.querySelector("div");
    expect(div?.className).not.toContain("bg-[var(--color-pipeline-danger)]");
  });

  it("muted variant includes ink text color class", () => {
    const { container } = render(<Card variant="muted">Content</Card>);
    const div = container.querySelector("div");
    expect(div?.className).toContain("text-[color:var(--color-pipeline-ink)]");
  });

  it("default variant (no prop) renders as white", () => {
    const { container } = render(<Card>Default</Card>);
    const div = container.querySelector("div");
    expect(div?.getAttribute("data-variant")).toBe("white");
    expect(div?.className).toContain("bg-[var(--color-pipeline-surface)]");
  });
});
