import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TvlCard } from "./TvlCard";
import type { YieldBarPoint } from "@/utils/yieldSeries";

const JUL_20_2026 = Date.UTC(2026, 6, 20, 12);
const AUG_20_2026 = Date.UTC(2026, 7, 20, 12);

const BARS: YieldBarPoint[] = [
  { value: 10, timestamp: JUL_20_2026, height: 0.4 },
  { value: 20, timestamp: Date.UTC(2026, 7, 1, 12), height: 0.8 },
  { value: 15, timestamp: AUG_20_2026, height: 0.6 },
];

function renderCard(tvlBars: YieldBarPoint[] | null) {
  return render(
    <TvlCard
      headlineTvl="$43.1M"
      outstandingInLoans="$31.6M"
      deployedRatio={0.733}
      tvlBars={tvlBars}
    />,
  );
}

describe("TvlCard — endpoint dates row (#1133)", () => {
  it("renders the series' first/last timestamps as 'MMM D' labels", () => {
    renderCard(BARS);
    const row = screen.getByTestId("chart-dates-row");
    expect(row).toBeInTheDocument();
    expect(screen.getByText("Jul 20")).toBeInTheDocument();
    expect(screen.getByText("Aug 20")).toBeInTheDocument();
  });

  it("renders both labels with the same date for a single-point series", () => {
    renderCard([BARS[0]!]);
    expect(screen.getAllByText("Jul 20")).toHaveLength(2);
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
