/** Tests for PortfolioPlaceholderCard — header states + the zero-value placeholder chart (#1114). */
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PortfolioPlaceholderCard } from "./PortfolioPlaceholderCard";
import { slotTimestamps, buildSeries } from "./usePortfolioChart";
import { formatAxisDateRange } from "@/utils/formatDate";

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

function renderCard(
  props: Partial<React.ComponentProps<typeof PortfolioPlaceholderCard>> = {},
) {
  return render(<PortfolioPlaceholderCard {...props} />);
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

describe("PortfolioPlaceholderCard — endpoint dates row (#1133)", () => {
  it("renders the active period window's endpoints as axis labels", () => {
    renderCard();
    const row = screen.getByTestId("chart-dates-row");
    const [start, end] = Array.from(row.children).map((c) => c.textContent);
    const now = Date.now();
    const ts = slotTimestamps("all", now);
    const expected = formatAxisDateRange(ts[0]!, now);
    expect(end).toBe(expected.end);
    expect(start).toBe(expected.start);
  });

  it("start label tracks the selected period tab", async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole("tab", { name: "7D" }));
    const row = screen.getByTestId("chart-dates-row");
    const start = row.children[0]!.textContent;
    const ts = slotTimestamps("7d", Date.now());
    expect(start).toBe(formatAxisDateRange(ts[0]!, ts[ts.length - 1]!).start);
  });
});

describe("PortfolioPlaceholderCard — served series mode (#1138)", () => {
  const SERIES = {
    timestamps: [
      Date.UTC(2026, 6, 20, 12),
      Date.UTC(2026, 7, 5, 12),
      Date.UTC(2026, 7, 20, 12),
    ],
    values: [0, 500, 1000],
  };

  it("renders one bar per served bucket instead of the 100 placeholder slots", () => {
    const { container } = renderCard({ series: SERIES });
    expect(container.querySelectorAll("[data-bar-slot]")).toHaveLength(3);
  });

  it("axis labels come from the served series endpoints", () => {
    renderCard({ series: SERIES });
    const row = screen.getByTestId("chart-dates-row");
    expect(row.children[0]!.textContent).toBe("Jul 20");
    expect(row.children[1]!.textContent).toBe("Aug 20");
  });

  it("appends 'YY to both labels when the endpoints cross a year boundary", () => {
    renderCard({
      series: {
        timestamps: [Date.UTC(2025, 7, 20, 12), Date.UTC(2026, 7, 20, 12)],
        values: [0, 1000],
      },
    });
    const row = screen.getByTestId("chart-dates-row");
    expect(row.children[0]!.textContent).toBe("Aug 20 '25");
    expect(row.children[1]!.textContent).toBe("Aug 20 '26");
  });

  it("falls back to the zero placeholder when series is null", () => {
    const { container } = renderCard({ series: null });
    expect(container.querySelectorAll("[data-bar-slot]")).toHaveLength(100);
  });
});

describe("buildSeries (#1138)", () => {
  it("scales raw share strings by decimals and parses timestamps", () => {
    const s = buildSeries(
      [
        {
          timestamp: "2026-07-20T00:00:00Z",
          shares_balance: "10000000",
        },
        {
          timestamp: "2026-08-20T00:00:00Z",
          shares_balance: "25000000",
        },
      ],
      7,
    );
    expect(s).not.toBeNull();
    expect(s!.values).toEqual([1, 2.5]);
    expect(s!.timestamps[0]).toBe(Date.parse("2026-07-20T00:00:00Z"));
  });

  it("returns null for empty or malformed history", () => {
    expect(buildSeries([], 7)).toBeNull();
    expect(buildSeries(undefined, 7)).toBeNull();
    expect(
      buildSeries([{ timestamp: "not-a-date", shares_balance: "1" }], 7),
    ).toBeNull();
  });
});
