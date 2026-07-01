/**
 * Unit tests for the Footer component (Issue #746, epic #712).
 *
 * Covers:
 *   1. Footer renders as a <footer> landmark with the correct data-testid.
 *   2. Logo renders inside the footer with aria-label="Pipeline".
 *   3. All five nav link labels render as anchors with placeholder hrefs
 *      (href="#") and aria-disabled="true" per the resolved Open Question 1.
 *   4. Disclaimer and copyright text render.
 *   5. Responsive class assertions — flex-col / md:flex-row stacking on both rows.
 *   6. Footer is NOT a descendant of any content container (rendered standalone here).
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Footer } from "./Footer";

// @pipeline/ui — Logo is a real SVG. Rendering it is fine in jsdom (no wagmi / network deps).

describe("Footer — landmark and testid", () => {
  it("renders a <footer> element with data-testid='site-footer'", () => {
    render(<Footer />);
    const footer = screen.getByTestId("site-footer");
    expect(footer).toBeInTheDocument();
    expect(footer.tagName.toLowerCase()).toBe("footer");
  });

  it("has data-node-id='3283:13463' matching the Figma frame", () => {
    render(<Footer />);
    const footer = screen.getByTestId("site-footer");
    expect(footer).toHaveAttribute("data-node-id", "3283:13463");
  });
});

describe("Footer — wordmark", () => {
  it("renders a Logo with aria-label='Pipeline'", () => {
    render(<Footer />);
    // Logo renders an SVG with aria-label="Pipeline" (see Logo.test.tsx).
    const logo = screen.getByRole("img", { name: "Pipeline" });
    expect(logo).toBeInTheDocument();
  });
});

describe("Footer — nav links", () => {
  const EXPECTED_LINKS = [
    "Docs",
    "White Paper",
    "GitHub",
    "X (Twitter)",
    "Telegram",
  ];

  it("renders a footer nav with aria-label='Footer'", () => {
    render(<Footer />);
    const nav = screen.getByRole("navigation", { name: "Footer" });
    expect(nav).toBeInTheDocument();
  });

  it.each(EXPECTED_LINKS)(
    "renders '%s' as a non-navigating placeholder anchor",
    (label) => {
      render(<Footer />);
      // getAllByRole because the same label might be in multiple roles;
      // we specifically want the anchor.
      const link = screen.getByRole("link", { name: label });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute("href", "#");
      expect(link).toHaveAttribute("aria-disabled", "true");
    },
  );

  it("renders exactly five footer nav links", () => {
    render(<Footer />);
    const nav = screen.getByRole("navigation", { name: "Footer" });
    const links = nav.querySelectorAll("a");
    expect(links).toHaveLength(5);
  });
});

describe("Footer — disclaimer and copyright", () => {
  it("renders the disclaimer paragraph", () => {
    render(<Footer />);
    const disclaimer = screen.getByTestId("footer-disclaimer");
    expect(disclaimer).toBeInTheDocument();
    // Check a distinctive substring from the disclaimer copy.
    expect(disclaimer.textContent).toContain("Pipeline is a financial protocol");
    expect(disclaimer.textContent).toContain("due diligence");
  });

  it("renders the copyright text", () => {
    render(<Footer />);
    const copyright = screen.getByTestId("footer-copyright");
    expect(copyright).toBeInTheDocument();
    expect(copyright).toHaveTextContent("© 2026 Pipeline Trust Company");
  });
});

describe("Footer — responsive structure", () => {
  it("row 1 (footer-row-links) carries flex-col and md:flex-row stacking classes", () => {
    render(<Footer />);
    const row1 = screen.getByTestId("footer-row-links");
    expect(row1.className).toContain("flex-col");
    expect(row1.className).toContain("md:flex-row");
  });

  it("row 2 (footer-row-disclaimer) carries flex-col and md:flex-row stacking classes", () => {
    render(<Footer />);
    const row2 = screen.getByTestId("footer-row-disclaimer");
    expect(row2.className).toContain("flex-col");
    expect(row2.className).toContain("md:flex-row");
  });

  it("outer footer carries mobile padding p-8 and desktop md:p-24 classes", () => {
    render(<Footer />);
    const footer = screen.getByTestId("site-footer");
    expect(footer.className).toContain("p-8");
    expect(footer.className).toContain("md:p-24");
  });
});
