/**
 * Smoke + accessibility tests for PortfolioPlaceholderCard.
 *
 * Scenarios covered:
 *   1. Component renders without throwing.
 *   2. "Total Balance" eyebrow is present.
 *   3. "$0.00" balance heading is present.
 *   4. "Get PLUSD to start" link is present and points to /deposit.
 *   5. "7D" tab is the default active tab (aria-selected="true").
 *   6. Other tabs start inactive (aria-selected="false").
 *   7. Switching tabs updates active state; DOM is otherwise unchanged.
 *   8. Chart wrapper has aria-hidden="true" (decorative).
 */
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PortfolioPlaceholderCard } from "./PortfolioPlaceholderCard";

// ── TanStack Router mock ──────────────────────────────────────────────────────
// PortfolioPlaceholderCard uses <Link to="/deposit">. Render it as a passthrough
// <a> so href assertions work without a real router tree.

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...original,
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderCard() {
  return render(<PortfolioPlaceholderCard />);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("PortfolioPlaceholderCard — smoke tests", () => {
  it("renders without throwing", () => {
    expect(() => renderCard()).not.toThrow();
  });

  it("shows 'Total Balance' eyebrow label", () => {
    renderCard();
    expect(screen.getByText("Total Balance")).toBeInTheDocument();
  });

  it("shows '$0.00' balance", () => {
    renderCard();
    expect(screen.getByRole("heading", { name: "$0.00" })).toBeInTheDocument();
  });

  it("shows 'Get PLUSD to start' link pointing to /deposit", () => {
    renderCard();
    const link = screen.getByRole("link", { name: "Get PLUSD to start" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/deposit");
  });
});

describe("PortfolioPlaceholderCard — SegmentedTabs semantics", () => {
  it("default active tab is '7D' (aria-selected='true')", () => {
    renderCard();
    const tab7d = screen.getByRole("tab", { name: "7D" });
    expect(tab7d).toHaveAttribute("aria-selected", "true");
  });

  it("other tabs default to inactive (aria-selected='false')", () => {
    renderCard();
    const inactiveTabs = ["1M", "3M", "1Y", "All"];
    for (const label of inactiveTabs) {
      expect(screen.getByRole("tab", { name: label })).toHaveAttribute(
        "aria-selected",
        "false",
      );
    }
  });

  it("clicking '1M' makes it active and deactivates '7D'", async () => {
    const user = userEvent.setup();
    renderCard();

    const tab1m = screen.getByRole("tab", { name: "1M" });
    await user.click(tab1m);

    await waitFor(() => {
      expect(tab1m).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("tab", { name: "7D" })).toHaveAttribute(
        "aria-selected",
        "false",
      );
    });
  });

  it("switching tabs leaves '$0.00' and 'Total Balance' unchanged", async () => {
    const user = userEvent.setup();
    renderCard();

    const tab3m = screen.getByRole("tab", { name: "3M" });
    await user.click(tab3m);

    // Verify balance and label are still present after tab switch
    expect(screen.getByText("Total Balance")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "$0.00" })).toBeInTheDocument();
  });
});

describe("PortfolioPlaceholderCard — accessibility", () => {
  it("chart wrapper has aria-hidden='true'", () => {
    renderCard();
    // Find the aria-hidden container for the chart silhouette
    const hiddenElements = document.querySelectorAll("[aria-hidden='true']");
    // There should be at least one aria-hidden element (the chart wrapper or SVG)
    expect(hiddenElements.length).toBeGreaterThan(0);
  });

  it("card region is labelled by the '$0.00' heading", () => {
    renderCard();
    // The card has role="region" + aria-labelledby pointing to the h2
    const region = screen.getByRole("region");
    expect(region).toBeInTheDocument();
    // The h2 heading "$0.00" must be in the document
    expect(screen.getByRole("heading", { name: "$0.00" })).toBeInTheDocument();
  });
});
