/**
 * ActivityHeader — responsive layout unit tests (Issue #523).
 *
 * Guards the structural and responsive-class contract so the mobile layout
 * (left-aligned heading, hidden icon) is not silently reverted.
 *
 * Hosted in `packages/frontend` because that package owns the vitest runner
 * (jsdom + globals). `packages/ui` does not have a test runner.
 *
 * Scenarios covered:
 *   1. Renders without throwing.
 *   2. Renders a semantic `<h2>` with the default "Activity" heading text.
 *   3. Custom `title` prop overrides the heading text.
 *   4. The HeroIcon carries `hidden md:block` responsive classes so it is
 *      hidden on mobile viewports.
 *   5. The root container carries `items-start md:items-center` so the heading
 *      is left-aligned on mobile and centred on desktop.
 *   6. The root container carries `w-full` so the heading fills the row on mobile.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ActivityHeader } from "@pipeline/ui";

describe("ActivityHeader — default rendering", () => {
  it("renders without throwing", () => {
    expect(() => render(<ActivityHeader />)).not.toThrow();
  });

  it("renders a semantic <h2> with the default 'Activity' text", () => {
    render(<ActivityHeader />);
    const heading = screen.getByRole("heading", { level: 2, name: "Activity" });
    expect(heading).toBeInTheDocument();
  });

  it("renders the heading with the custom title when title prop is provided", () => {
    render(<ActivityHeader title="Transactions" />);
    const heading = screen.getByRole("heading", {
      level: 2,
      name: "Transactions",
    });
    expect(heading).toBeInTheDocument();
  });
});

describe("ActivityHeader — responsive classes (Issue #523)", () => {
  it("root container carries items-start md:items-center for left-aligned mobile heading", () => {
    const { container } = render(<ActivityHeader />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("items-start");
    expect(root.className).toContain("md:items-center");
  });

  it("root container carries w-full so the heading fills the row on mobile", () => {
    const { container } = render(<ActivityHeader />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("w-full");
  });

  it("HeroIcon carries hidden md:block so it is hidden on mobile", () => {
    const { container } = render(<ActivityHeader />);
    // HeroIcon renders as a div; it is the first child of the root container.
    // The className on that div must include 'hidden' and 'md:block'.
    const heroIconDiv = container.firstElementChild
      ?.firstElementChild as HTMLElement | null;
    expect(heroIconDiv).not.toBeNull();
    expect(heroIconDiv?.className).toContain("hidden");
    expect(heroIconDiv?.className).toContain("md:block");
  });
});
