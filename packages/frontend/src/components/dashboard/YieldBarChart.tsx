/**
 * YieldBarChart — reusable inline-SVG bar chart for the Yield History panel.
 *
 * Renders a fixed number of thin vertical bars, each a single solid `<rect>`
 * in one flat colour (matching the Figma chart — no glow/opacity layering).
 *
 * On hover the chart shows a tooltip with the bar's value and date, and a
 * faint highlight band marks the hovered slot. Pointer tracking is mouse-only
 * (touch is deferred — logged in tech-debt-tracker.md).
 *
 * Props:
 *   - `bars`        — array of `{ height: number (0–100), value: number, timestamp: number }`.
 *   - `fill`        — bar fill colour; defaults to the green chart-positive token.
 *   - `formatValue` — formats a bar's numeric value for the tooltip; defaults
 *                     to compact USD (both series this chart backs are USD).
 *   - `className`   — appended to the wrapper element.
 *
 * One file = one component (FRONTEND.md rule 1). No data fetching — presentational.
 *
 * Figma reference: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-68337
 */
import { useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { YieldBarPoint } from "@/utils/yieldSeries";
import { formatCompactUsd } from "@/utils/formatCompactUsd";

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
  formatValue?: (value: number) => string;
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

/** Default tooltip value formatter — compact USD from a human-unit number. */
function defaultFormatValue(value: number): string {
  return formatCompactUsd(String(value));
}

/** Formats a bar's unix-ms timestamp as e.g. "Jul 5, 2026" for the tooltip. */
function formatBarDate(tsMs: number): string {
  return new Date(tsMs).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Renders a bar chart as an inline SVG of single-colour vertical bars, with a
 * hover tooltip showing the value and date of the bar under the cursor.
 */
export function YieldBarChart({
  bars,
  fill = DEFAULT_FILL,
  formatValue = defaultFormatValue,
  className,
  "aria-label": ariaLabel,
}: YieldBarChartProps) {
  const n = bars.length;
  const wrapRef = useRef<HTMLDivElement>(null);
  // Hovered bar: index + cursor x (px, relative to the wrapper) for tooltip placement.
  const [hover, setHover] = useState<{ index: number; x: number } | null>(null);

  if (n === 0) return null;

  const handleMove = (e: ReactMouseEvent<HTMLDivElement>) => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) return;
    const relX = e.clientX - rect.left;
    const idx = Math.min(
      n - 1,
      Math.max(0, Math.floor((relX / rect.width) * n)),
    );
    setHover({ index: idx, x: relX });
  };

  const handleLeave = () => setHover(null);

  const slotW = VB_W / n;
  const hovered = hover ? bars[hover.index] : null;

  return (
    <div
      ref={wrapRef}
      className={["relative w-full", className].filter(Boolean).join(" ")}
      role="img"
      aria-label={ariaLabel ?? "Yield history chart"}
      data-testid="yield-bar-chart"
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
    >
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="none"
        className="h-full w-full"
        aria-hidden="true"
      >
        {/* Faint highlight band behind the hovered slot. */}
        {hover && (
          <rect
            x={hover.index * slotW}
            y={0}
            width={slotW}
            height={VB_H}
            fill="var(--color-pipeline-ink)"
            opacity={0.06}
            data-testid="yield-bar-hover-band"
          />
        )}
        {bars.map((pt, i) => {
          const cx = slotCentreX(i, n);
          const barH = (pt.height / 100) * VB_H;
          const y0 = VB_H - barH;

          // Single solid bar — one flat colour, no opacity layering (Figma).
          return (
            <rect
              key={i}
              data-bar-slot={i}
              x={cx - 1.5}
              y={y0}
              width={3}
              height={barH}
              fill={fill}
            />
          );
        })}
      </svg>

      {/* Tooltip — value + date of the hovered bar. Pinned to the top, follows x. */}
      {hovered && hover && (
        <div
          className={[
            "pointer-events-none absolute top-0 z-10 -translate-x-1/2",
            "flex flex-col gap-0.5 whitespace-nowrap",
            "rounded-[var(--radius-pipeline-card)] px-2 py-1",
            "border border-[color:var(--color-pipeline-line)]",
            "bg-[color:var(--color-pipeline-surface)] shadow-sm",
          ].join(" ")}
          style={{ left: `${hover.x}px` }}
          data-testid="yield-bar-tooltip"
        >
          <span
            className={[
              "font-[family-name:var(--font-body)]",
              "text-[length:var(--text-pipeline-caption)]",
              "leading-[var(--text-pipeline-caption--line-height)]",
              "font-medium",
              "text-[color:var(--color-pipeline-ink)]",
            ].join(" ")}
          >
            {formatValue(hovered.value)}
          </span>
          <span
            className={[
              "font-[family-name:var(--font-body)]",
              "text-[length:var(--text-pipeline-caption)]",
              "leading-[var(--text-pipeline-caption--line-height)]",
              "font-normal",
              "text-[color:var(--color-pipeline-ink-muted)]",
            ].join(" ")}
          >
            {formatBarDate(hovered.timestamp)}
          </span>
        </div>
      )}
    </div>
  );
}

export default YieldBarChart;
