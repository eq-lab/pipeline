// spec: docs/frontend/dashboard-components.md#portfolioplaceholdercard
import { describe, it, expect, vi } from "vitest";
import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  cleanup,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PortfolioPlaceholderCard } from "./PortfolioPlaceholderCard";
import {
  slotTimestamps,
  buildSeries,
  seriesSpans,
  bucketCentreX,
  stepIndexAt,
} from "./usePortfolioChart";
import { sampleAxisDates } from "@/utils/formatDate";
import type { AxisTicks } from "@/utils/chartAxis";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...original,
    Link: ({
      children,
      to,
      search,
    }: {
      children: React.ReactNode;
      to: string;
      search?: Record<string, string>;
    }) => {
      const qs = search ? new URLSearchParams(search).toString() : "";
      return <a href={qs ? `${to}?${qs}` : to}>{children}</a>;
    },
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
    expect(link).toHaveAttribute("href", "/deposit?direction=deposit");
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
    ).toHaveAttribute("href", "/stake?tab=stake");
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

describe("PortfolioPlaceholderCard — endpoint dates row (#1133, widened to 5 labels by #1234)", () => {
  it("renders 5 labels sampled from the active period window's timestamps", () => {
    renderCard();
    const row = screen.getByTestId("chart-dates-row");
    const labels = Array.from(row.children).map((c) => c.textContent);
    const ts = slotTimestamps("all", Date.now());
    expect(labels).toEqual(sampleAxisDates(ts));
  });

  it("start label tracks the selected period tab", async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole("tab", { name: "7D" }));
    const row = screen.getByTestId("chart-dates-row");
    const start = row.children[0]!.textContent;
    const ts = slotTimestamps("7d", Date.now());
    expect(start).toBe(sampleAxisDates(ts)[0]);
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

  it("renders one green two-rect bar per served bucket (#1140, Figma 1497:95197)", () => {
    const { container } = renderCard({ series: SERIES });
    const slots = container.querySelectorAll("[data-bar-slot]");
    expect(slots).toHaveLength(3);
    const rects = slots[2]!.querySelectorAll("rect");
    expect(rects).toHaveLength(2);
    for (const rect of Array.from(rects)) {
      expect(rect.getAttribute("fill")).toBe(
        "var(--color-pipeline-chart-positive)",
      );
    }
  });

  it("axis labels come from the served series timestamps (5 labels)", () => {
    renderCard({ series: SERIES });
    const row = screen.getByTestId("chart-dates-row");
    expect(row.children).toHaveLength(5);
    expect(row.children[0]!.textContent).toBe("Jul 20");
    expect(row.children[row.children.length - 1]!.textContent).toBe("Aug 20");
  });

  it("appends 'YY to every label when the sampled points cross a year boundary", () => {
    renderCard({
      series: {
        timestamps: [Date.UTC(2025, 7, 20, 12), Date.UTC(2026, 7, 20, 12)],
        values: [0, 1000],
      },
    });
    const row = screen.getByTestId("chart-dates-row");
    expect(row.children[0]!.textContent).toBe("Aug 20 '25");
    expect(row.children[row.children.length - 1]!.textContent).toBe(
      "Aug 20 '26",
    );
  });

  it("falls back to the zero placeholder when series is null", () => {
    const { container } = renderCard({ series: null });
    expect(container.querySelectorAll("[data-bar-slot]")).toHaveLength(100);
  });
});

describe("PortfolioPlaceholderCard — Y axis (#1234)", () => {
  const SERIES = {
    timestamps: [
      Date.UTC(2026, 6, 20, 12),
      Date.UTC(2026, 7, 5, 12),
      Date.UTC(2026, 7, 20, 12),
    ],
    values: [0, 500, 1000],
  };

  const AXIS: AxisTicks = {
    maxLabel: "$1K",
    midLabel: "$500",
    bottomLabel: "$0",
  };

  it("renders the Y ticks from the passed-in axis (derived from shares_balance.max)", () => {
    renderCard({ series: SERIES, yAxis: AXIS });
    expect(screen.getByTestId("chart-value-axis-max")).toHaveTextContent("$1K");
    expect(screen.getByTestId("chart-value-axis-mid")).toHaveTextContent(
      "$500",
    );
    expect(screen.getByTestId("chart-value-axis-bottom")).toHaveTextContent(
      "$0",
    );
  });

  it("renders no Y axis when yAxis is omitted, even with a served series", () => {
    renderCard({ series: SERIES });
    expect(screen.queryByTestId("chart-value-axis")).not.toBeInTheDocument();
  });

  it("renders no fabricated Y axis in placeholder mode, even if yAxis is passed", () => {
    renderCard({ series: null, yAxis: AXIS });
    expect(screen.queryByTestId("chart-value-axis")).not.toBeInTheDocument();
  });
});

describe("buildSeries (#1138, #1629)", () => {
  it("parses served splusd_value verbatim, ignoring shares_balance and decimals", () => {
    const s = buildSeries([
      {
        timestamp: "2026-07-20T00:00:00Z",
        splusd_value: "1001.503214",
        shares_balance: "999",
      } as { timestamp: string; splusd_value?: string },
      { timestamp: "2026-08-20T00:00:00Z", splusd_value: "2.5" },
    ]);
    expect(s).not.toBeNull();
    expect(s!.values).toEqual([1001.503214, 2.5]);
    expect(s!.timestamps[0]).toBe(Date.parse("2026-07-20T00:00:00Z"));
  });

  it("maps a bucket without splusd_value to null and keeps its timestamp", () => {
    const s = buildSeries([
      { timestamp: "2026-07-20T00:00:00Z" },
      { timestamp: "2026-08-20T00:00:00Z", splusd_value: "abc" },
    ]);
    expect(s!.values).toEqual([null, null]);
    expect(s!.timestamps).toHaveLength(2);
  });

  it("returns null for empty or malformed history", () => {
    expect(buildSeries([])).toBeNull();
    expect(buildSeries(undefined)).toBeNull();
    expect(
      buildSeries([{ timestamp: "not-a-date", splusd_value: "1" }]),
    ).toBeNull();
  });
});

describe("step helpers (#1629)", () => {
  const H = 3_600_000;
  const t = Date.UTC(2026, 8, 21, 0, 0);

  it("stepIndexAt picks the latest bucket at or before the time, clamped", () => {
    const ts = [t, t + H, t + 10 * H];
    expect(stepIndexAt(ts, t + H)).toBe(1);
    expect(stepIndexAt(ts, t + 5 * H)).toBe(1);
    expect(stepIndexAt(ts, t - H)).toBe(0);
    expect(stepIndexAt(ts, t + 99 * H)).toBe(2);
    expect(stepIndexAt([t], t + H)).toBe(0);
  });

  it("seriesSpans uses the median step and 1 for a single bucket", () => {
    expect(seriesSpans([t, t + H, t + 2 * H])).toEqual({
      t0: t,
      tEnd: t + 3 * H,
      step: H,
    });
    expect(seriesSpans([t, t + H, t + 10 * H])).toEqual({
      t0: t,
      tEnd: t + 10 * H + 5 * H,
      step: 5 * H,
    });
    expect(seriesSpans([t])).toEqual({ t0: t, tEnd: t + 1, step: 1 });
  });

  it("bucketCentreX equals the index slot centre for a uniform series", () => {
    const ts = [t, t + H, t + 2 * H];
    const spans = seriesSpans(ts);
    ts.forEach((_, i) => {
      expect(bucketCentreX(i, ts, spans, 680)).toBeCloseTo(
        ((i + 0.5) * 680) / 3,
        6,
      );
    });
  });
});

describe("series mode on the served value (#1629)", () => {
  const H = 3_600_000;
  const t = Date.UTC(2026, 8, 21, 0, 0);

  function renderSeries(timestamps: number[], values: (number | null)[]) {
    const view = render(
      <PortfolioPlaceholderCard
        balanceLabel="$0.00"
        series={{ timestamps, values }}
      />,
    );
    const chartWrap = view.container.querySelector(
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
    return { ...view, chartWrap };
  }

  function barCentre(container: HTMLElement, i: number): number {
    const rect = container.querySelector(
      `[data-bar-slot='${i}'] rect`,
    ) as SVGRectElement;
    return (
      Number(rect.getAttribute("x")) + Number(rect.getAttribute("width")) / 2
    );
  }

  it("tooltip shows the formatted value, and an em dash for a missing bucket", () => {
    const { chartWrap } = renderSeries(
      [t, t + H, t + 2 * H],
      [1001.5, null, 3],
    );
    const tooltip = screen.getByTestId("chart-tooltip");
    fireEvent.pointerMove(chartWrap, { clientX: 10 });
    expect(tooltip.textContent).toContain("$1,001.50");
    fireEvent.pointerMove(chartWrap, { clientX: 300 });
    expect(tooltip.textContent).toContain("—");
    expect(tooltip.textContent).not.toContain("$0.00");
  });

  it("a null bucket renders a data-missing slot with no rect", () => {
    const { container } = renderSeries([t, t + H], [null, 5]);
    const slot = container.querySelector("[data-bar-slot='0']")!;
    expect(slot).toHaveAttribute("data-missing", "true");
    expect(slot.querySelector("rect")).toBeNull();
    expect(container.querySelectorAll("[data-bar-slot]")).toHaveLength(2);
  });

  it("places bars on the timestamp scale", () => {
    const { container } = renderSeries([t, t + H, t + 10 * H], [1, 2, 3]);
    [1 / 30, 11 / 30, 25 / 30].forEach((f, i) => {
      expect(barCentre(container as HTMLElement, i)).toBeCloseTo(680 * f, 4);
    });
  });

  it("hover picks the latest bucket at or before the cursor time", () => {
    const { chartWrap } = renderSeries([t, t + H, t + 10 * H], [1, 2, 3]);
    const tooltip = screen.getByTestId("chart-tooltip");
    fireEvent.pointerMove(chartWrap, { clientX: 600 * (5 / 15) });
    expect(tooltip.textContent).toContain("$2.00");
    fireEvent.pointerMove(chartWrap, { clientX: 600 * (0.5 / 15) });
    expect(tooltip.textContent).toContain("$1.00");
  });

  it("a dense uniform series keeps the index slot positions", () => {
    const { container } = renderSeries([t, t + H, t + 2 * H], [1, 2, 3]);
    [0, 1, 2].forEach((i) => {
      expect(barCentre(container as HTMLElement, i)).toBeCloseTo(
        ((i + 0.5) * 680) / 3,
        4,
      );
    });
  });
});

describe("tooltip timestamp format per period (#1223, #1234 revision)", () => {
  function hoverWithSeries(
    activePeriodId: string,
    base = Date.UTC(2026, 8, 21, 14, 13),
  ) {
    const timestamps = Array.from(
      { length: 10 },
      (_, i) => base - (9 - i) * 3_600_000,
    );
    const values = timestamps.map((_, i) => i * 100);
    const { container } = render(
      <PortfolioPlaceholderCard
        activePeriodId={activePeriodId}
        onActivePeriodChange={() => {}}
        balanceLabel="$0.00"
        series={{ timestamps, values }}
      />,
    );
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
    fireEvent.pointerMove(chartWrap, { clientX: 599 });
    const text =
      within(container as HTMLElement).getByTestId("chart-tooltip")
        .textContent ?? "";
    cleanup();
    return text;
  }

  it("7d shows day and time", () => {
    expect(hoverWithSeries("7d")).toMatch(/September 21, \d{2}:\d{2}/);
  });

  it.each(["1m", "3m"])("%s shows day and year", (id) => {
    const text = hoverWithSeries(id);
    expect(text).toContain("September 21, 2026");
    expect(text).not.toMatch(/\d{2}:\d{2}/);
  });

  it.each(["1y", "all"])(
    "%s shows the full date plus the time the served timestamp carries",
    (id) => {
      expect(hoverWithSeries(id)).toContain("September 21, 2026, 14:13");
    },
  );

  it.each(["1y", "all"])(
    "%s shows the full date with no time for a midnight (daily-bucket) timestamp",
    (id) => {
      const text = hoverWithSeries(id, Date.UTC(2026, 8, 22, 0, 0));
      expect(text).toContain("September 22, 2026");
      expect(text).not.toMatch(/\d{2}:\d{2}/);
    },
  );
});

describe("PortfolioPlaceholderCard — connect-wallet variant (#1422)", () => {
  it("renders a Connect wallet button and fires onConnectWallet on click", async () => {
    const onConnectWallet = vi.fn();
    const user = userEvent.setup();
    renderCard({ variant: "connect-wallet", onConnectWallet });

    const button = screen.getByRole("button", { name: "Connect wallet" });
    await user.click(button);

    expect(onConnectWallet).toHaveBeenCalledOnce();
  });

  it("renders no unrealized-PnL caption and no 'Get PLUSD to start' link", () => {
    renderCard({ variant: "connect-wallet" });

    expect(screen.queryByTestId("earning-caption")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Get PLUSD to start" }),
    ).not.toBeInTheDocument();
  });

  it("still shows the Total Balance heading and $0.00 default", () => {
    renderCard({ variant: "connect-wallet" });

    expect(screen.getByText("Total Balance")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "$0.00" })).toBeInTheDocument();
  });

  it("sets data-node-id and data-variant for the connect-wallet variant", () => {
    renderCard({ variant: "connect-wallet" });
    expect(screen.getByRole("region")).toHaveAttribute(
      "data-node-id",
      "6701:97649",
    );
    expect(screen.getByRole("region")).toHaveAttribute(
      "data-variant",
      "connect-wallet",
    );
  });

  it("the default variant still renders the caption and the link (regression)", () => {
    renderCard();

    expect(screen.getByTestId("earning-caption")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Get PLUSD to start" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("region")).toHaveAttribute(
      "data-node-id",
      "1497:95048",
    );
  });
});

describe("PortfolioPlaceholderCard — get-plusd variant (#1423)", () => {
  it("renders Total Balance, the passed balanceLabel and the Get PLUSD to start link", () => {
    renderCard({ variant: "get-plusd", balanceLabel: "$0.00" });

    expect(screen.getByText("Total Balance")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "$0.00" })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Get PLUSD to start" }),
    ).toHaveAttribute("href", "/deposit?direction=deposit");
  });

  it("renders no unrealized-PnL caption and no Connect wallet control", () => {
    renderCard({ variant: "get-plusd" });

    expect(screen.queryByTestId("earning-caption")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Connect wallet" }),
    ).not.toBeInTheDocument();
  });

  it("ignores mobileHomeState and keeps the Get PLUSD to start link", () => {
    renderCard({ variant: "get-plusd", mobileHomeState: "splusd" });

    expect(
      screen.getByRole("link", { name: "Get PLUSD to start" }),
    ).toBeInTheDocument();
  });

  it("sets data-node-id and data-variant for the get-plusd variant", () => {
    renderCard({ variant: "get-plusd" });

    const region = screen.getByRole("region");
    expect(region).toHaveAttribute("data-node-id", "6701:98528");
    expect(region).toHaveAttribute("data-variant", "get-plusd");
    expect(region.className).toContain("h-[274px]");
  });

  it("drops the PnL clause from the chart aria-label", () => {
    renderCard({ variant: "get-plusd", balanceLabel: "$0.00" });

    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "Total balance for All: $0.00",
    );
  });
});

describe("PortfolioPlaceholderCard — stake-or-add-usd variant (#1424)", () => {
  it("renders Total Balance, the served balanceLabel and the split-action sentence", () => {
    renderCard({ variant: "stake-or-add-usd", balanceLabel: "$0.00" });

    expect(screen.getByText("Total Balance")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "$0.00" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Stake PLUSD" })).toHaveAttribute(
      "href",
      "/stake?tab=stake",
    );
    expect(screen.getByRole("button", { name: "Add USD" })).toBeInTheDocument();
    expect(screen.getByText("or")).toBeInTheDocument();
    expect(screen.getByText("to start earning")).toBeInTheDocument();
  });

  it("fires onAddFunds when 'Add USD' is clicked", async () => {
    const onAddFunds = vi.fn();
    const user = userEvent.setup();
    renderCard({ variant: "stake-or-add-usd", onAddFunds });

    await user.click(screen.getByRole("button", { name: "Add USD" }));

    expect(onAddFunds).toHaveBeenCalledOnce();
  });

  it("renders no unrealized-PnL caption, no Connect wallet and no Get PLUSD to start link", () => {
    renderCard({ variant: "stake-or-add-usd" });

    expect(screen.queryByTestId("earning-caption")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Connect wallet" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Get PLUSD to start" }),
    ).not.toBeInTheDocument();
  });

  it("sets data-node-id and data-variant for the stake-or-add-usd variant", () => {
    renderCard({ variant: "stake-or-add-usd" });

    const region = screen.getByRole("region");
    expect(region).toHaveAttribute("data-node-id", "6701:97451");
    expect(region).toHaveAttribute("data-variant", "stake-or-add-usd");
  });
});
