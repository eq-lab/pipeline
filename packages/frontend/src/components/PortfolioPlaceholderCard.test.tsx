/** Tests for PortfolioPlaceholderCard — header states + the zero-value placeholder chart (#1114). */
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PortfolioPlaceholderCard } from "./PortfolioPlaceholderCard";

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

function renderCard() {
  return render(<PortfolioPlaceholderCard />);
}

describe("PortfolioPlaceholderCard — header", () => {
  it("renders without throwing", () => {
    expect(() => renderCard()).not.toThrow();
  });

  it("shows 'Total Balance' eyebrow label", () => {
    renderCard();
    expect(screen.getByText("Total Balance")).toBeInTheDocument();
  });

  it("shows '$0.00' balance and labels the card region with it", () => {
    renderCard();
    expect(screen.getByRole("region")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "$0.00" })).toBeInTheDocument();
  });

  it("shows 'Get PLUSD to start' link pointing to /deposit", () => {
    renderCard();
    const link = screen.getByRole("link", { name: "Get PLUSD to start" });
    expect(link).toHaveAttribute("href", "/deposit");
  });

  it("renders provided sPLUSD balance as the main heading", () => {
    render(
      <PortfolioPlaceholderCard
        balanceLabel="1,000.00 sPLUSD"
        unrealizedPnlLabel="+$42.80 unrealized"
      />,
    );
    expect(
      screen.getByRole("heading", { name: "1,000.00 sPLUSD" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("earning-caption")).toHaveTextContent(
      "+$42.80 unrealized",
    );
  });

  it("shows the stake CTA for the plusd state and none for splusd", () => {
    const { rerender } = render(
      <PortfolioPlaceholderCard mobileHomeState="plusd" />,
    );
    expect(
      screen.getByRole("link", { name: "Stake PLUSD to start earning" }),
    ).toHaveAttribute("href", "/stake");
    rerender(<PortfolioPlaceholderCard mobileHomeState="splusd" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("PortfolioPlaceholderCard — SegmentedTabs semantics", () => {
  it("default active tab is 'All' (aria-selected='true')", () => {
    renderCard();
    expect(screen.getByRole("tab", { name: "All" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("clicking '1M' makes it active and deactivates 'All'", async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole("tab", { name: "1M" }));
    expect(screen.getByRole("tab", { name: "1M" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "All" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });
});

describe("PortfolioPlaceholderCard — zero-value placeholder chart (#1114)", () => {
  it("renders 100 flat placeholder bar slots with the grey placeholder fill", () => {
    const { container } = renderCard();
    const slots = container.querySelectorAll("[data-bar-slot]");
    expect(slots).toHaveLength(100);
    const rect = slots[0]!.querySelector("rect")!;
    expect(rect.getAttribute("fill")).toBe("#D5D8C8");
    const heights = new Set(
      Array.from(slots).map((g) =>
        g.querySelector("rect")!.getAttribute("height"),
      ),
    );
    expect(heights.size).toBe(1);
  });

  it("chart wrapper has role='img' and a descriptive aria-label", () => {
    renderCard();
    const wrap = screen.getByRole("img");
    expect(wrap.getAttribute("aria-label")).toContain("Total balance for All");
  });

  it("tooltip is initially hidden and shows $0.00 on hover — never a fabricated value", async () => {
    const { container } = renderCard();
    const tooltip = screen.getByTestId("chart-tooltip");
    expect(tooltip).toHaveAttribute("aria-hidden", "true");

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
      expect(tooltip).toHaveAttribute("aria-hidden", "false");
      expect(tooltip.textContent).toContain("$0.00");
    });

    fireEvent.pointerLeave(chartWrap);
    await waitFor(() => {
      expect(tooltip).toHaveAttribute("aria-hidden", "true");
    });
  });
});

describe("PortfolioPlaceholderCard — responsive header layout", () => {
  it("header wrapper has mobile-stacked and md-row responsive classes", () => {
    const { container } = renderCard();
    const wrapper = container.querySelector(
      "[data-node-id='1497:95048'] > div:first-child",
    ) as HTMLElement;
    expect(wrapper).toBeTruthy();
    expect(wrapper.className).toContain("flex-col");
    expect(wrapper.className).toContain("md:flex-row");
  });
});
