// spec: docs/frontend/dashboard-components.md#portfolioplaceholdercard
import { useCallback, useRef, useState } from "react";

export const N = 100;

export type FormatMode = "datetime" | "date" | "dateAuto";

export interface PeriodConfig {
  days: number;
  fmt: FormatMode;
}

export const PERIODS: Record<string, PeriodConfig> = {
  "7d": { days: 7, fmt: "datetime" },
  "1m": { days: 30, fmt: "date" },
  "3m": { days: 90, fmt: "date" },
  "1y": { days: 365, fmt: "dateAuto" },
  all: { days: 730, fmt: "dateAuto" },
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
    case "dateAuto":
      return d.getHours() === 0 && d.getMinutes() === 0
        ? `${month} ${day}, ${year}`
        : `${month} ${day}, ${year}, ${hh}:${mm}`;
  }
}

export function slotTimestamps(periodId: string, now: number): number[] {
  const { days } = getPeriod(periodId);
  const periodMs = days * 24 * 60 * 60 * 1000;
  const stepMs = periodMs / (N - 1);
  return Array.from({ length: N }, (_, i) => now - periodMs + i * stepMs);
}

export interface TooltipInfo {
  balance: number | null;
  timestamp: number;
}

export interface ChartSeries {
  timestamps: number[];
  values: (number | null)[];
}

export function buildSeries(
  history: { timestamp: string; total_balance?: string }[] | undefined,
): ChartSeries | null {
  if (!history || history.length === 0) return null;
  const timestamps: number[] = [];
  const values: (number | null)[] = [];
  for (const item of history) {
    const ts = Date.parse(item.timestamp);
    if (!Number.isFinite(ts)) return null;
    const value =
      item.total_balance === undefined ? null : Number(item.total_balance);
    timestamps.push(ts);
    values.push(value !== null && Number.isFinite(value) ? value : null);
  }
  return { timestamps, values };
}

export interface LatestTotalBalance {
  totalBalance: string | undefined;
  includesPlusd: boolean;
}

export function latestTotalBalance(
  history: { total_balance?: string; plusd_balance?: string }[] | undefined,
): LatestTotalBalance | null {
  const last = history?.[history.length - 1];
  if (!last) return null;
  return {
    totalBalance: last.total_balance,
    includesPlusd: last.plusd_balance !== undefined,
  };
}

export interface SeriesSpans {
  t0: number;
  tEnd: number;
  step: number;
}

export function seriesSpans(timestamps: number[]): SeriesSpans {
  const diffs: number[] = [];
  for (let i = 1; i < timestamps.length; i++) {
    diffs.push(timestamps[i]! - timestamps[i - 1]!);
  }
  let step = 1;
  if (diffs.length > 0) {
    const sorted = [...diffs].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    step =
      sorted.length % 2 === 1
        ? sorted[mid]!
        : (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  const t0 = timestamps[0] ?? 0;
  const last = timestamps[timestamps.length - 1] ?? 0;
  return { t0, tEnd: last + step, step };
}

export function bucketCentreX(
  i: number,
  timestamps: number[],
  spans: SeriesSpans,
  width: number,
): number {
  const start = timestamps[i]!;
  const end = i + 1 < timestamps.length ? timestamps[i + 1]! : spans.tEnd;
  const domain = spans.tEnd - spans.t0;
  if (domain <= 0) return width / 2;
  return (((start + end) / 2 - spans.t0) / domain) * width;
}

export function stepIndexAt(timestamps: number[], t: number): number {
  let lo = 0;
  let hi = timestamps.length - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (timestamps[mid]! <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

export interface PortfolioChartState {
  activeId: string;
  setActiveId: (id: string) => void;
  period: PeriodConfig;
  timestamps: number[];
  slotCount: number;
  xOf: (i: number, width: number) => number;
  stepWidth: (width: number) => number;
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

  const isSeries = !!series?.timestamps.length;
  const spans = seriesSpans(timestamps);
  const { t0, tEnd, step } = spans;

  const xOf = (i: number, width: number): number =>
    isSeries
      ? bucketCentreX(i, timestamps, spans, width)
      : ((i + 0.5) * width) / slotCount;

  const stepWidth = (width: number): number =>
    isSeries && tEnd > t0 ? (step / (tEnd - t0)) * width : width / slotCount;

  const onPointerMove = useCallback(
    (clientX: number, rect: DOMRect) => {
      const x = clientX - rect.left;
      const fraction = Math.max(0, Math.min(1, x / rect.width));
      if (isSeries) {
        setHoveredIdx(stepIndexAt(timestamps, t0 + fraction * (tEnd - t0)));
        return;
      }
      setHoveredIdx(Math.min(slotCount - 1, Math.floor(fraction * slotCount)));
    },
    [isSeries, timestamps, t0, tEnd, slotCount],
  );

  const onPointerLeave = useCallback(() => {
    setHoveredIdx(null);
  }, []);

  const tooltip: TooltipInfo | null =
    hoveredIdx !== null && timestamps[hoveredIdx] != null
      ? {
          balance: isSeries ? (series?.values[hoveredIdx] ?? null) : 0,
          timestamp: timestamps[hoveredIdx]!,
        }
      : null;

  return {
    activeId,
    setActiveId,
    period: getPeriod(activeId),
    timestamps,
    slotCount,
    xOf,
    stepWidth,
    hoveredIdx,
    tooltip,
    onPointerMove,
    onPointerLeave,
  };
}
