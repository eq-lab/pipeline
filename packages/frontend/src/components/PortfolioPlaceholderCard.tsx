import React from "react";
import { Link } from "@tanstack/react-router";
import { Card, SegmentedTabs } from "@pipeline/ui";
import {
  N,
  formatMoney,
  formatTime,
  usePortfolioChart,
} from "./usePortfolioChart";

/**
 * PortfolioPlaceholderCard — Connected-state replacement for ConnectWalletPromoCard.
 *
 * Renders in the top-left slot of the home dashboard when `isConnected === true`
 * (Figma node `1497:95048`). This is a **placeholder** — the balance stays `$0.00`
 * and the chart data is procedurally generated (no API calls). Replace the
 * synthetic generator with a real aggregation endpoint when one ships.
 *
 * Layout:
 *   ┌────────────────────────────────────────────────────────────────────┐
 *   │  Total Balance                    [ 7D | 1M | 3M | 1Y | All ]     │
 *   │  $0.00                                                             │
 *   │  +$42.80 earning  ← updates with selected period                  │
 *   │  Get PLUSD to start →                                              │
 *   ├────────────────────────────────────────────────────────────────────┤
 *   │  ████████████████████████████████████████████████████████████      │
 *   │  Interactive 100-bar stacked monotonic-growth chart                │
 *   │  Hover → vertical cursor line + tooltip (balance + timestamp)      │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 * Chart rendering:
 *   - 100 bar slots. Each slot has 3 nested rectangles (widths 3/2/1 px wide
 *     in SVG-coordinate terms, centred on the slot) at heights 30%/60%/100% of
 *     the slot's balance height, giving a "soft glow" stacked appearance.
 *   - Bar fill: `--color-pipeline-chart-positive` (`#2D7B1F`) — the prototype
 *     colour, introduced as a dedicated chart token.
 *   - Curve is deterministic per period (seeded LCG). Heights are monotonically
 *     non-decreasing. Curve is anchored to `Date.now()` at mount time.
 *
 * Hover interaction:
 *   - Pointer move over the chart wrapper snaps to the nearest slot index.
 *   - A vertical cursor line is drawn at the slot's X position.
 *   - A tooltip floats above the cursor showing balance + period-appropriate
 *     timestamp. The tooltip is clamped horizontally to stay inside the chart
 *     bounds (half-width = 70px) — the cursor line is NOT clamped (prototype
 *     behaviour verbatim).
 *   - Mouse only — touch support deferred (logged in tech-debt-tracker.md).
 *
 * Accessibility:
 *   - Chart wrap: `role="img"` + descriptive `aria-label` (period + earning).
 *   - Individual bar `<rect>` elements are decorative — no aria attributes.
 *   - The card `<region>` is labelled by the `$0.00` heading.
 *
 * Placeholder rule:
 *   - `$0.00` is a string literal — replace when the aggregation endpoint is ready.
 *   - Earning caption uses the prototype's per-period synthetic value — replace
 *     when real per-period earnings are available.
 *   - "Get PLUSD to start" link is always shown — revisit when user holds PLUSD.
 *
 * Figma reference: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1497-95048
 */

export type PortfolioPlaceholderCardProps = Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "children"
>;

/** Stable heading id — avoids collision when multiple cards mount in preview/story. */
const HEADING_ID = "portfolio-placeholder-card-title";

const TABS = [
  { id: "7d", label: "7D" },
  { id: "1m", label: "1M" },
  { id: "3m", label: "3M" },
  { id: "1y", label: "1Y" },
  { id: "all", label: "All" },
];

/** SVG viewBox dimensions */
const VB_W = 680;
const VB_H = 120;

/** Tooltip half-width in px — used for clamping (must match CSS). */
const TOOLTIP_HALF = 70;

/**
 * Map a slot index to its centre X within the SVG viewBox coordinate system.
 * The viewBox is `VB_W × VB_H`. Each slot occupies `VB_W / N` units.
 */
function slotCentreX(idx: number): number {
  const slotW = VB_W / N;
  return idx * slotW + slotW / 2;
}

export const PortfolioPlaceholderCard = React.forwardRef<
  HTMLDivElement,
  PortfolioPlaceholderCardProps
>(function PortfolioPlaceholderCard({ className, ...rest }, ref) {
  const {
    activeId,
    setActiveId,
    period,
    curve,
    hoveredIdx,
    tooltip,
    onPointerMove,
    onPointerLeave,
    earning,
  } = usePortfolioChart();

  /** Ref to the chart wrapper div for getBoundingClientRect on pointer move. */
  const wrapRef = React.useRef<HTMLDivElement>(null);

  const handlePointerMove = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!wrapRef.current) return;
      onPointerMove(e.clientX, wrapRef.current.getBoundingClientRect());
    },
    [onPointerMove],
  );

  /**
   * Tooltip left offset as a percentage of the wrapper width.
   * We clamp so the tooltip (width ~140px, half = 70px) stays inside.
   * The cursor line itself is NOT clamped (prototype behaviour verbatim).
   */
  const tooltipLeftPct =
    hoveredIdx !== null
      ? ((slotCentreX(hoveredIdx) / VB_W) * 100).toFixed(2)
      : "0";

  /** Cursor line X as a percentage of the wrapper width (not clamped). */
  const cursorLeftPct =
    hoveredIdx !== null
      ? ((slotCentreX(hoveredIdx) / VB_W) * 100).toFixed(2)
      : "0";

  const periodLabel = TABS.find((t) => t.id === activeId)?.label ?? "7D";
  const earningStr = formatMoney(earning);

  const composed = [
    "relative flex flex-col gap-6",
    "min-h-[274px] w-full",
    "overflow-hidden",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Card
      ref={ref}
      variant="yellow"
      role="region"
      aria-labelledby={HEADING_ID}
      className={composed}
      data-node-id="1497:95048"
      {...rest}
    >
      {/* Header row — left: balance stack; right: segmented time-range tabs */}
      <div className="flex items-start justify-between gap-4">
        {/* Left: Total Balance label + $0.00 display + earning caption + "Get PLUSD" link */}
        <header className="flex flex-col gap-1">
          {/* Eyebrow label — Caption token, muted ink */}
          <span
            className={[
              "font-[family-name:var(--font-body)]",
              "text-[length:var(--text-pipeline-caption)]",
              "leading-[var(--text-pipeline-caption--line-height)]",
              "font-[var(--font-weight-regular)]",
              "text-[color:var(--color-pipeline-ink-muted)]",
            ].join(" ")}
          >
            Total Balance
          </span>

          {/* Balance display — Heading M token, display serif */}
          <h2
            id={HEADING_ID}
            className={[
              "font-[family-name:var(--font-display)]",
              "text-[length:var(--text-pipeline-heading-m)]",
              "leading-[var(--text-pipeline-heading-m--line-height)]",
              "font-[var(--font-weight-regular)]",
              "text-[color:var(--color-pipeline-ink)]",
              "m-0",
            ].join(" ")}
          >
            $0.00
          </h2>

          {/* Earning caption — updates with selected period */}
          <span
            data-testid="earning-caption"
            className={[
              "font-[family-name:var(--font-body)]",
              "text-[length:var(--text-pipeline-caption)]",
              "leading-[var(--text-pipeline-caption--line-height)]",
              "font-[var(--font-weight-regular)]",
              "text-[color:var(--color-pipeline-ink-muted)]",
            ].join(" ")}
          >
            +{earningStr} earning
          </span>

          {/* "Get PLUSD to start" — muted caption link to /deposit */}
          <Link
            to="/deposit"
            search={{ direction: "deposit" as const }}
            className={[
              "font-[family-name:var(--font-body)]",
              "text-[length:var(--text-pipeline-caption)]",
              "leading-[var(--text-pipeline-caption--line-height)]",
              "font-[var(--font-weight-regular)]",
              "text-[color:var(--color-pipeline-ink-muted)]",
              "underline-offset-2 hover:underline",
              "no-underline",
            ].join(" ")}
          >
            Get PLUSD to start
          </Link>
        </header>

        {/* Right: time-range segmented tabs */}
        <SegmentedTabs
          tabs={TABS}
          activeId={activeId}
          onSelect={setActiveId}
          className="w-[220px] shrink-0"
        />
      </div>

      {/* Body: interactive stacked-bars monotonic-growth chart.
          The wrap is position:relative so the cursor + tooltip overlays
          (position:absolute) sit correctly. */}
      <div
        ref={wrapRef}
        className="relative flex-1"
        role="img"
        aria-label={`Total balance for ${periodLabel}: $0.00 (+${earningStr} earning)`}
        data-node-id="1497:95048-chart"
        onPointerMove={handlePointerMove}
        onPointerLeave={onPointerLeave}
      >
        {/* Chart SVG — 100 stacked tri-rect bars */}
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="none"
          className="h-full w-full"
          aria-hidden="true"
        >
          {curve.map((pt, i) => {
            const cx = slotCentreX(i);
            const barH = (pt.height / 100) * VB_H;
            const y0 = VB_H - barH;
            return (
              <g key={i} data-bar-slot={i}>
                {/* Outer rect (full height, narrowest opacity — glow) */}
                <rect
                  x={cx - 1.5}
                  y={y0}
                  width={3}
                  height={barH}
                  fill="var(--color-pipeline-chart-positive)"
                  opacity={0.35}
                />
                {/* Mid rect (60% height) */}
                <rect
                  x={cx - 1}
                  y={y0 + barH * 0.4}
                  width={2}
                  height={barH * 0.6}
                  fill="var(--color-pipeline-chart-positive)"
                  opacity={0.65}
                />
                {/* Core rect (30% height, full opacity) */}
                <rect
                  x={cx - 0.5}
                  y={y0 + barH * 0.7}
                  width={1}
                  height={barH * 0.3}
                  fill="var(--color-pipeline-chart-positive)"
                  opacity={1}
                />
              </g>
            );
          })}
        </svg>

        {/* Vertical cursor line — not clamped (prototype behaviour) */}
        {hoveredIdx !== null && (
          <div
            aria-hidden="true"
            style={{ left: `${cursorLeftPct}%` }}
            className="pointer-events-none absolute inset-y-0 w-px -translate-x-1/2 bg-[var(--color-pipeline-chart-positive)]"
          />
        )}

        {/* Tooltip — clamped to chart bounds */}
        <div
          aria-hidden={hoveredIdx === null}
          data-testid="chart-tooltip"
          style={{
            left:
              hoveredIdx !== null
                ? `clamp(${TOOLTIP_HALF}px, ${tooltipLeftPct}%, calc(100% - ${TOOLTIP_HALF}px))`
                : "50%",
            opacity: hoveredIdx !== null ? 1 : 0,
            pointerEvents: "none",
          }}
          className={[
            "absolute bottom-full mb-2",
            "-translate-x-1/2",
            "rounded px-3 py-1.5",
            "bg-[var(--color-pipeline-ink)]",
            "text-[color:var(--color-pipeline-on-dark)]",
            "font-[family-name:var(--font-body)]",
            "text-[length:var(--text-pipeline-caption)]",
            "leading-[var(--text-pipeline-caption--line-height)]",
            "whitespace-nowrap",
            "transition-opacity duration-75",
          ].join(" ")}
        >
          {tooltip !== null ? (
            <>
              <span className="block font-[var(--font-weight-medium)]">
                {formatMoney(tooltip.balance)}
              </span>
              <span className="block opacity-70">
                {formatTime(tooltip.timestamp, period.fmt)}
              </span>
            </>
          ) : null}
        </div>
      </div>
    </Card>
  );
});

PortfolioPlaceholderCard.displayName = "PortfolioPlaceholderCard";

export default PortfolioPlaceholderCard;
