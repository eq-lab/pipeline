/**
 * Zero-value placeholder chart state for PortfolioPlaceholderCard (#1114):
 * period tabs, per-slot timestamps over the selected window, and hover state.
 * Every balance is 0 until a per-address history series exists (#1116) — no
 * synthetic curve is generated.
 * spec: docs/frontend/dashboard-components.md#portfolioplaceholdercard.
 */
import { useCallback, useRef, useState } from "react";

export const N = 100;

export type FormatMode = "datetime" | "date" | "month";

export interface PeriodConfig {
  days: number;
  fmt: FormatMode;
}

export const PERIODS: Record<string, PeriodConfig> = {
  "7d": { days: 7, fmt: "datetime" },
  "1m": { days: 30, fmt: "date" },
  "3m": { days: 90, fmt: "date" },
  "1y": { days: 365, fmt: "month" },
  all: { days: 730, fmt: "month" },
};

export const DEFAULT_PERIOD_ID = "all";

export function getPeriod(id: string): PeriodConfig {
  return PERIODS[id] ?? PERIODS[DEFAULT_PERIOD_ID]!;
}

export function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function formatTime(ts: number, fmt: FormatMode): string {
  const d = new Date(ts);
  const month = MONTH_NAMES[d.getMonth()];
  const day = d.getDate();
  const year = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");

  switch (fmt) {
    case "datetime":
      return `${month} ${day}, ${hh}:${mm}`;
    case "date":
      return `${month} ${day}, ${year}`;
    case "month":
      return `${month} ${year}`;
  }
}

export function slotTimestamps(periodId: string, now: number): number[] {
  const { days } = getPeriod(periodId);
  const periodMs = days * 24 * 60 * 60 * 1000;
  const stepMs = periodMs / (N - 1);
  return Array.from({ length: N }, (_, i) => now - periodMs + i * stepMs);
}

export interface TooltipInfo {
  balance: number;
  timestamp: number;
}

/** Served series (#1138): parallel arrays of bucket timestamps and values. */
export interface ChartSeries {
  timestamps: number[];
  values: number[];
}

export function buildSeries(
  history: { timestamp: string; shares_balance: string }[] | undefined,
  decimals: number,
): ChartSeries | null {
  if (!history || history.length === 0) return null;
  const timestamps: number[] = [];
  const values: number[] = [];
  for (const item of history) {
    const ts = Date.parse(item.timestamp);
    const value = Number(item.shares_balance) / 10 ** decimals;
    if (!Number.isFinite(ts) || !Number.isFinite(value)) return null;
    timestamps.push(ts);
    values.push(value);
  }
  return { timestamps, values };
}

export interface PortfolioChartState {
  activeId: string;
  setActiveId: (id: string) => void;
  period: PeriodConfig;
  timestamps: number[];
  slotCount: number;
  hoveredIdx: number | null;
  tooltip: TooltipInfo | null;
  onPointerMove: (clientX: number, rect: DOMRect) => void;
  onPointerLeave: () => void;
}

export function usePortfolioChart(params: {
  activeId: string;
  setActiveId: (id: string) => void;
  series?: ChartSeries | null;
}): PortfolioChartState {
  const { activeId, setActiveId, series } = params;
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const nowRef = useRef<number>(Date.now());

  const timestamps = series?.timestamps.length
    ? series.timestamps
    : slotTimestamps(activeId, nowRef.current);
  const slotCount = timestamps.length;

  const onPointerMove = useCallback(
    (clientX: number, rect: DOMRect) => {
      const x = clientX - rect.left;
      const fraction = Math.max(0, Math.min(1, x / rect.width));
      setHoveredIdx(Math.min(slotCount - 1, Math.floor(fraction * slotCount)));
    },
    [slotCount],
  );

  const onPointerLeave = useCallback(() => {
    setHoveredIdx(null);
  }, []);

  const tooltip: TooltipInfo | null =
    hoveredIdx !== null && timestamps[hoveredIdx] != null
      ? {
          balance: series?.values[hoveredIdx] ?? 0,
          timestamp: timestamps[hoveredIdx]!,
        }
      : null;

  return {
    activeId,
    setActiveId,
    period: getPeriod(activeId),
    timestamps,
    slotCount,
    hoveredIdx,
    tooltip,
    onPointerMove,
    onPointerLeave,
  };
}
