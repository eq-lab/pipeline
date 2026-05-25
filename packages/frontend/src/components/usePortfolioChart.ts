/**
 * usePortfolioChart — co-located hook for PortfolioPlaceholderCard.
 *
 * Owns:
 *  - Active time-range period (7d / 1m / 3m / 1y / all).
 *  - Deterministic balance-history curve generated per period.
 *  - Hover state (nearest slot index, tooltip content).
 *
 * Data is entirely synthetic (placeholder) — no API calls, no React Query.
 * Replace `generateCurve` with a real data fetch when the aggregation endpoint
 * ships. See Issue #389 for the graduation plan.
 *
 * Algorithm:
 *   The curve mirrors the prototype in
 *   `docs.local/stacked_bars_natural_monotonic_growth.html`.
 *   Given `N = 100` slots, `startBalance = endBalance − period.earning`,
 *   a random-looking but deterministic non-decreasing sequence is produced
 *   by drawing increments from a seeded pseudo-random pool and normalising
 *   them to sum to the total earning. Heights are the balances normalised to
 *   a 0–100 percentage of the final (maximum) balance.
 */

import { useCallback, useRef, useState } from "react";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Number of bar slots rendered by the chart. */
export const N = 100;

/** Maximum balance value used for height normalisation. */
const END_BALANCE = 1042.8;

/** Seed value for the pseudo-random increment pool (prototype parity). */
const SEED = 42;

// ── Period map ────────────────────────────────────────────────────────────────

export type FormatMode = "datetime" | "date" | "month";

export interface PeriodConfig {
  days: number;
  earning: number;
  fmt: FormatMode;
}

export const PERIODS: Record<string, PeriodConfig> = {
  "7d": { days: 7, earning: 42.8, fmt: "datetime" },
  "1m": { days: 30, earning: 92.8, fmt: "date" },
  "3m": { days: 90, earning: 192.8, fmt: "date" },
  "1y": { days: 365, earning: 542.8, fmt: "month" },
  all: { days: 730, earning: 842.8, fmt: "month" },
};

/** Default period used as a fallback when an unknown id is requested. */
const DEFAULT_PERIOD: PeriodConfig = { days: 7, earning: 42.8, fmt: "datetime" };

/** Safely look up a period, falling back to DEFAULT_PERIOD. */
export function getPeriod(id: string): PeriodConfig {
  return PERIODS[id] ?? DEFAULT_PERIOD;
}

// ── Curve types ───────────────────────────────────────────────────────────────

export interface CurvePoint {
  balance: number;
  /** height as a percentage (0–100) of END_BALANCE */
  height: number;
  /** Unix timestamp (ms) for this slot */
  timestamp: number;
}

// ── Pure helpers (exported for unit tests) ────────────────────────────────────

/**
 * Seeded deterministic pseudo-random number generator (LCG, prototype parity).
 * Returns a sequence of floats in [0, 1).
 */
function makeRng(seed: number) {
  let s = seed;
  return function next(): number {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    // Unsigned right shift to keep positive, then normalise to [0,1)
    return ((s >>> 0) / 0x100000000) * 0.9 + 0.1; // skew away from 0
  };
}

/**
 * Generate a deterministic monotonic-growth balance curve for the given period.
 *
 * @param periodId - one of the PERIODS keys
 * @param now      - anchor timestamp in ms (defaults to Date.now())
 * @returns        - array of N CurvePoints, monotonically non-decreasing in balance
 */
export function generateCurve(
  periodId: string,
  now: number = Date.now(),
): CurvePoint[] {
  const period = getPeriod(periodId);
  const { days, earning } = period;

  const startBalance = END_BALANCE - earning;
  const rng = makeRng(SEED);

  // Draw N raw increments, all positive
  const raw: number[] = [];
  for (let i = 0; i < N; i++) {
    raw.push(rng());
  }

  // Normalise so increments sum to total earning
  const rawSum = raw.reduce((a, b) => a + b, 0);
  const increments = raw.map((v) => (v / rawSum) * earning);

  // Build cumulative balance array (monotonically non-decreasing)
  const balances: number[] = [];
  let running = startBalance;
  for (let i = 0; i < N; i++) {
    running += increments[i] ?? 0;
    balances.push(Math.round(running * 100) / 100);
  }

  // Ensure last slot is exactly END_BALANCE
  balances[N - 1] = END_BALANCE;

  // Timestamps: evenly spaced over the period, ending at `now`
  const periodMs = days * 24 * 60 * 60 * 1000;
  const stepMs = periodMs / (N - 1);

  return balances.map((balance, i) => ({
    balance,
    height: (balance / END_BALANCE) * 100,
    timestamp: now - periodMs + i * stepMs,
  }));
}

/**
 * Format a monetary value as US dollars.
 *
 * @example formatMoney(1042.8) → "$1,042.80"
 */
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

/**
 * Format a timestamp for the tooltip.
 *
 * - "datetime" → "January 1, 14:30"
 * - "date"     → "January 1, 2025"
 * - "month"    → "January 2025"
 */
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

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface TooltipInfo {
  balance: number;
  timestamp: number;
}

export interface PortfolioChartState {
  /** Currently active period id */
  activeId: string;
  /** Switch period */
  setActiveId: (id: string) => void;
  /** Period config for the active period */
  period: PeriodConfig;
  /** Pre-computed curve for the active period */
  curve: CurvePoint[];
  /** Hovered slot index, or null when not hovering */
  hoveredIdx: number | null;
  /** Tooltip data for the hovered slot, or null */
  tooltip: TooltipInfo | null;
  /** Pointer-move handler — call with the event and the wrap element's bounding rect */
  onPointerMove: (clientX: number, rect: DOMRect) => void;
  /** Pointer-leave handler */
  onPointerLeave: () => void;
  /** Earning amount for the active period */
  earning: number;
}

export function usePortfolioChart(): PortfolioChartState {
  const [activeId, setActiveId] = useState("7d");
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  // Stable anchor time — generated once per mount so the chart doesn't
  // re-render with a different curve on every hover event.
  const nowRef = useRef<number>(Date.now());

  // Recompute the curve only when the period changes (not on hover).
  // We use a ref + derived value pattern to keep it cheap.
  const curveRef = useRef<{ id: string; curve: CurvePoint[] } | null>(null);
  if (curveRef.current === null || curveRef.current.id !== activeId) {
    curveRef.current = {
      id: activeId,
      curve: generateCurve(activeId, nowRef.current),
    };
  }
  const curve = curveRef.current.curve;

  const period = getPeriod(activeId);

  const onPointerMove = useCallback((clientX: number, rect: DOMRect) => {
    const x = clientX - rect.left;
    const fraction = Math.max(0, Math.min(1, x / rect.width));
    const idx = Math.min(N - 1, Math.floor(fraction * N));
    setHoveredIdx(idx);
  }, []);

  const onPointerLeave = useCallback(() => {
    setHoveredIdx(null);
  }, []);

  const tooltip: TooltipInfo | null =
    hoveredIdx !== null && curve[hoveredIdx] != null
      ? { balance: curve[hoveredIdx]!.balance, timestamp: curve[hoveredIdx]!.timestamp }
      : null;

  return {
    activeId,
    setActiveId,
    period,
    curve,
    hoveredIdx,
    tooltip,
    onPointerMove,
    onPointerLeave,
    earning: period.earning,
  };
}
