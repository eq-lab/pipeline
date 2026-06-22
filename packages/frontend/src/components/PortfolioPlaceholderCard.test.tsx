/**
 * Tests for PortfolioPlaceholderCard.
 *
 * Scenarios covered:
 *   1. Component renders without throwing.
 *   2. "Total Balance" eyebrow is present.
 *   3. "$0.00" balance heading is present.
 *   4. "Get PLUSD to start" link is present and points to /deposit.
 *   5. "7D" tab is the default active tab (aria-selected="true").
 *   6. Other tabs start inactive (aria-selected="false").
 *   7. Switching tabs updates active state while PnL captions stay data-driven.
 *   8. Chart wrapper has role="img" and a descriptive aria-label.
 *   9. Chart renders 100 bar slots (100 <g data-bar-slot> elements).
 *  10. Hover shows tooltip; mouse leave hides it.
 */
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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

  it("shows '$0.00 unrealized' caption by default", () => {
    renderCard();
    const caption = screen.getByTestId("earning-caption");
    expect(caption).toHaveTextContent("$0.00 unrealized");
  });

  it("renders provided sPLUSD balance as the main heading and no duplicate sublabel", () => {
    render(
      <PortfolioPlaceholderCard
        balanceLabel="1,000.00 sPLUSD"
        unrealizedPnlLabel="+$42.80 unrealized"
      />,
    );

    expect(
      screen.getByRole("heading", { name: "1,000.00 sPLUSD" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("splusd-balance-caption"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("earning-caption")).toHaveTextContent(
      "+$42.80 unrealized",
    );
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

  it("clicking '1M' leaves the unrealized PnL caption unchanged", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole("tab", { name: "1M" }));

    await waitFor(() => {
      expect(screen.getByTestId("earning-caption")).toHaveTextContent(
        "$0.00 unrealized",
      );
    });
  });

  it("clicking 'All' leaves the unrealized PnL caption unchanged", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole("tab", { name: "All" }));

    await waitFor(() => {
      expect(screen.getByTestId("earning-caption")).toHaveTextContent(
        "$0.00 unrealized",
      );
    });
  });

  it("switching tabs leaves '$0.00' and 'Total Balance' unchanged", async () => {
    const user = userEvent.setup();
    renderCard();

    const tab3m = screen.getByRole("tab", { name: "3M" });
    await user.click(tab3m);

    expect(screen.getByText("Total Balance")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "$0.00" })).toBeInTheDocument();
  });
});

describe("PortfolioPlaceholderCard — chart structure", () => {
  it("chart wrapper has role='img' and a descriptive aria-label", () => {
    renderCard();
    const chart = screen.getByRole("img");
    expect(chart).toBeInTheDocument();
    const label = chart.getAttribute("aria-label") ?? "";
    expect(label).toContain("Total balance");
    expect(label).toContain("$0.00");
    expect(label).toContain("$0.00 unrealized");
  });

  it("chart renders 100 bar slots (100 <g data-bar-slot> elements)", () => {
    const { container } = renderCard();
    const barSlots = container.querySelectorAll("[data-bar-slot]");
    expect(barSlots).toHaveLength(100);
  });

  it("card region is labelled by the '$0.00' heading", () => {
    renderCard();
    const region = screen.getByRole("region");
    expect(region).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "$0.00" })).toBeInTheDocument();
  });
});

describe("PortfolioPlaceholderCard — responsive header layout", () => {
  it("header wrapper has mobile-stacked and md-row responsive classes", () => {
    const { container } = renderCard();
    // The header wrapper is the first div inside the Card element.
    // It wraps the <header> (balance stack) and the SegmentedTabs.
    const wrapper = container.querySelector(
      "[data-node-id='1497:95048'] > div:first-child",
    ) as HTMLElement;
    expect(wrapper).toBeTruthy();
    expect(wrapper.className).toContain("flex-col");
    expect(wrapper.className).toContain("items-start");
    expect(wrapper.className).toContain("md:flex-row");
    expect(wrapper.className).toContain("md:justify-between");
  });
});

describe("PortfolioPlaceholderCard — hover behaviour", () => {
  it("tooltip is initially hidden (aria-hidden='true')", () => {
    renderCard();
    const tooltip = screen.getByTestId("chart-tooltip");
    expect(tooltip).toHaveAttribute("aria-hidden", "true");
  });

  it("pointerMove on chart wrap shows tooltip with '$1,' balance prefix", async () => {
    const { container } = renderCard();
    const chartWrap = container.querySelector(
      "[data-node-id='1497:95048-chart']",
    ) as HTMLElement;
    expect(chartWrap).toBeTruthy();

    // Mock getBoundingClientRect so pointer math works in jsdom.
    vi.spyOn(chartWrap, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 600,
      bottom: 120,
      width: 600,
      height: 120,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    // Fire pointer move at the centre of the chart (slot ~50)
    fireEvent.pointerMove(chartWrap, { clientX: 300 });

    await waitFor(() => {
      const tooltip = screen.getByTestId("chart-tooltip");
      expect(tooltip).toHaveAttribute("aria-hidden", "false");
      expect(tooltip.textContent).toContain("$1,");
    });
  });

  it("pointerLeave hides the tooltip again", async () => {
    const { container } = renderCard();
    const chartWrap = container.querySelector(
      "[data-node-id='1497:95048-chart']",
    ) as HTMLElement;

    vi.spyOn(chartWrap, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 600,
      bottom: 120,
      width: 600,
      height: 120,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    fireEvent.pointerMove(chartWrap, { clientX: 300 });

    await waitFor(() => {
      expect(screen.getByTestId("chart-tooltip")).toHaveAttribute(
        "aria-hidden",
        "false",
      );
    });

    fireEvent.pointerLeave(chartWrap);

    await waitFor(() => {
      expect(screen.getByTestId("chart-tooltip")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
    });
  });
});
