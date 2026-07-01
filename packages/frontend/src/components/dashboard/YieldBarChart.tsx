/**
 * YieldBarChart — reusable inline-SVG bar chart for the Yield History panel.
 *
 * Renders a fixed number of thin vertical bars, each drawn as 3 nested
 * `<rect>` elements (outer glow, mid, core) at different opacities — exactly
 * matching the pattern in `PortfolioPlaceholderCard`.
 *
 * Props:
 *   - `bars`      — array of `{ height: number (0–100), value: number, timestamp: number }`.
 *   - `fill`      — bar fill colour; defaults to the green chart-positive token.
 *   - `className` — appended to the wrapper element.
 *
 * One file = one component (FRONTEND.md rule 1). No data fetching — purely
 * presentational.
 *
 * Touch interaction is deferred (mirrors the home chart); logged in
 * tech-debt-tracker.md.
 *
 * Figma reference: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-68337
 */
import type { YieldBarPoint } from "@/utils/yieldSeries";

// ── Constants ─────────────────────────────────────────────────────────────────

/** SVG viewBox dimensions — matches PortfolioPlaceholderCard. */
const VB_W = 680;
const VB_H = 120;

/** Default green bar fill — the chart-positive design token. */
const DEFAULT_FILL = "var(--color-pipeline-chart-positive)";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface YieldBarChartProps {
  bars: YieldBarPoint[];
  fill?: string;
  className?: string;
  "aria-label"?: string;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Map a slot index to its centre X within the SVG viewBox.
 * Each slot occupies `VB_W / bars.length` units.
 */
function slotCentreX(idx: number, totalBars: number): number {
  const slotW = VB_W / totalBars;
  return idx * slotW + slotW / 2;
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Renders a bar chart as an inline SVG of tri-layered vertical bars.
 *
 * Each bar has three nested `<rect>` elements at heights 30%/60%/100% of
 * the slot's `height` percentage, giving a "soft glow" appearance — mirroring
 * the chart in `PortfolioPlaceholderCard`.
 */
export function YieldBarChart({
  bars,
  fill = DEFAULT_FILL,
  className,
  "aria-label": ariaLabel,
}: YieldBarChartProps) {
  const n = bars.length;
  if (n === 0) return null;

  return (
    <div
      className={["relative w-full", className].filter(Boolean).join(" ")}
      role="img"
      aria-label={ariaLabel ?? "Yield history chart"}
      data-testid="yield-bar-chart"
    >
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="none"
        className="h-full w-full"
        aria-hidden="true"
      >
        {bars.map((pt, i) => {
          const cx = slotCentreX(i, n);
          const barH = (pt.height / 100) * VB_H;
          const y0 = VB_H - barH;

          return (
            <g key={i} data-bar-slot={i}>
              {/* Outer rect (full height, widest — soft glow effect) */}
              <rect
                x={cx - 1.5}
                y={y0}
                width={3}
                height={barH}
                fill={fill}
                opacity={0.35}
              />
              {/* Mid rect (60% height) */}
              <rect
                x={cx - 1}
                y={y0 + barH * 0.4}
                width={2}
                height={barH * 0.6}
                fill={fill}
                opacity={0.65}
              />
              {/* Core rect (30% height, full opacity) */}
              <rect
                x={cx - 0.5}
                y={y0 + barH * 0.7}
                width={1}
                height={barH * 0.3}
                fill={fill}
                opacity={1}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default YieldBarChart;
