import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TvlCard } from "./TvlCard";
import type { YieldBarPoint } from "@/utils/yieldSeries";
import type { AxisTicks } from "@/utils/chartAxis";

const JUL_20_2026 = Date.UTC(2026, 6, 20, 12);
const AUG_20_2026 = Date.UTC(2026, 7, 20, 12);

const BARS: YieldBarPoint[] = [
  { value: 10, timestamp: JUL_20_2026, height: 0.4 },
  { value: 20, timestamp: Date.UTC(2026, 7, 1, 12), height: 0.8 },
  { value: 15, timestamp: AUG_20_2026, height: 0.6 },
];

const AXIS: AxisTicks = {
  maxLabel: "$23M",
  midLabel: "$12M",
  bottomLabel: "$0",
};

function renderCard(
  tvlBars: YieldBarPoint[] | null,
  tvlAxis: AxisTicks | null = AXIS,
) {
  return render(
    <TvlCard
      headlineTvl="$43.1M"
      outstandingInLoans="$31.6M"
      deployedRatio={0.733}
      tvlBars={tvlBars}
      tvlAxis={tvlAxis}
    />,
  );
}

describe("TvlCard — endpoint dates row (#1133, widened to 5 labels by #1234)", () => {
  it("renders 5 'MMM D' labels sampled from the real served bar timestamps", () => {
    renderCard(BARS);
    const row = screen.getByTestId("chart-dates-row");
    expect(row).toBeInTheDocument();
    expect(row.children).toHaveLength(5);
    expect(row.children[0]!.textContent).toBe("Jul 20");
    expect(row.children[row.children.length - 1]!.textContent).toBe("Aug 20");
  });

  it("renders 5 labels all matching the single date for a single-point series", () => {
    renderCard([BARS[0]!]);
    const row = screen.getByTestId("chart-dates-row");
    expect(Array.from(row.children).map((c) => c.textContent)).toEqual([
      "Jul 20",
      "Jul 20",
      "Jul 20",
      "Jul 20",
      "Jul 20",
    ]);
  });

  it("renders no dates row when the series is null", () => {
    renderCard(null);
    expect(screen.queryByTestId("chart-dates-row")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("dashboard-tvl-chart-placeholder"),
    ).toBeInTheDocument();
  });

  it("renders no dates row when the series is empty", () => {
    renderCard([]);
    expect(screen.queryByTestId("chart-dates-row")).not.toBeInTheDocument();
  });
});

describe("TvlCard — Y axis (#1234)", () => {
  it("renders the three Y ticks (top/max÷2/$0) with the Figma formatting", () => {
    renderCard(BARS);
    expect(screen.getByTestId("chart-value-axis-max")).toHaveTextContent(
      "$23M",
    );
    expect(screen.getByTestId("chart-value-axis-mid")).toHaveTextContent(
      "$12M",
    );
    expect(screen.getByTestId("chart-value-axis-bottom")).toHaveTextContent(
      "$0",
    );
  });

  it("renders no Y axis when the stats block is absent", () => {
    renderCard(BARS, null);
    expect(screen.queryByTestId("chart-value-axis")).not.toBeInTheDocument();
  });

  it("renders no Y axis alongside the empty chart placeholder", () => {
    renderCard(null, null);
    expect(screen.queryByTestId("chart-value-axis")).not.toBeInTheDocument();
  });
});
