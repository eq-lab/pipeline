import React from "react";
import { Link } from "@tanstack/react-router";
import { Card, SegmentedTabs } from "@pipeline/ui";

/**
 * PortfolioPlaceholderCard — Connected-state replacement for ConnectWalletPromoCard.
 *
 * Renders in the top-left slot of the home dashboard when `isConnected === true`
 * (Figma node `1497:95048`). This is a **static placeholder** — every value is
 * a literal; no data is fetched; the chart is a decorative silhouette.
 *
 * Layout (three vertical sections):
 *   ┌────────────────────────────────────────────────────────────┐
 *   │  Total Balance              [ 7D | 1M | 3M | 1Y | All ]   │
 *   │  $0.00                                                     │
 *   │  Get PLUSD to start →                                      │
 *   ├────────────────────────────────────────────────────────────┤
 *   │  ▄ ▄ ▄ ▅ ▅ ▆ ▇ ▇ ▄ ▅ ▆ ▇ ▇ ▆ ▅ ▅ ▄ ▄ ▄ ▄ ▄ ▅ ▅ ▅ ▃ ▃ ▃  │
 *   │  (static bar-chart silhouette — aria-hidden)               │
 *   └────────────────────────────────────────────────────────────┘
 *
 * Composition (all primitives from `@pipeline/ui`):
 *   - {@link Card} `variant="yellow"` — same surface as `ConnectWalletPromoCard`
 *     so the grid does not reflow when the wallet connects.
 *   - {@link SegmentedTabs} — `7D / 1M / 3M / 1Y / All`. Active tab is
 *     maintained in a local `useState`; selecting a tab updates the visual
 *     only — no data fetch is triggered (deferred until the aggregation
 *     endpoint ships).
 *   - `<Link to="/deposit">` (TanStack Router) — "Get PLUSD to start" muted
 *     underlined link beneath the balance figure.
 *   - Inline `<svg>` bar-chart silhouette — static, `aria-hidden="true"`.
 *     All colours flow through design-system tokens (`--color-pipeline-surface-muted`).
 *
 * Placeholder rule:
 *   - `$0.00` is a string literal — replace when the aggregation endpoint is ready.
 *   - Tab selection does not change the chart — replace when time-series data is ready.
 *   - "Get PLUSD to start" copy is constant — revisit when the user holds PLUSD.
 *
 * Accessibility:
 *   - `role="region"` + `aria-labelledby` → "Total Balance, region".
 *   - Chart `<svg>` is `aria-hidden="true"` — it is purely decorative.
 *   - The "Get PLUSD to start" link is a real anchor.
 *
 * Figma reference: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1497-95048
 */

export type PortfolioPlaceholderCardProps = Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "children"
>;

// Stable heading id — avoids collision when multiple cards mount in a
// preview / story.
const HEADING_ID = "portfolio-placeholder-card-title";

const TABS = [
  { id: "7d", label: "7D" },
  { id: "1m", label: "1M" },
  { id: "3m", label: "3M" },
  { id: "1y", label: "1Y" },
  { id: "all", label: "All" },
];

/**
 * Bar heights (0–100) for the static chart silhouette. Values approximate the
 * Figma frame `1497:95048` (node "chart placeholder"). The curve rises in the
 * middle and tapers at both ends to suggest historical activity.
 *
 * These are purely decorative — replace with real data when the aggregation
 * endpoint is available. See: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1497-95048
 */
const BAR_HEIGHTS = [
  18, 22, 28, 32, 35, 40, 46, 52, 58, 63, 68, 72, 75, 78, 80, 82, 80, 77, 73,
  69, 65, 60, 55, 50, 44, 38, 32, 26, 20, 15,
];

export const PortfolioPlaceholderCard = React.forwardRef<
  HTMLDivElement,
  PortfolioPlaceholderCardProps
>(function PortfolioPlaceholderCard({ className, ...rest }, ref) {
  const [activeId, setActiveId] = React.useState("7d");

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
        {/* Left: Total Balance label + $0.00 display + "Get PLUSD" link */}
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

        {/* Right: time-range segmented tabs (decorative — no chart update) */}
        <SegmentedTabs
          tabs={TABS}
          activeId={activeId}
          onSelect={setActiveId}
          className="w-[220px] shrink-0"
        />
      </div>

      {/* Body: static bar-chart silhouette — purely decorative, aria-hidden.
          Inline SVG preferred for pixel-perfect rendering at any container width.
          Bars use `--color-pipeline-surface-muted` so the silhouette reads on the
          yellow Card surface without introducing a raw colour value.
          See Figma node 1497:95048 "chart placeholder". */}
      <div
        className="flex-1"
        aria-hidden="true"
        data-node-id="1497:95048-chart"
      >
        <svg
          viewBox={`0 0 ${BAR_HEIGHTS.length * 14} 100`}
          preserveAspectRatio="none"
          className="h-full w-full"
          aria-hidden="true"
        >
          {BAR_HEIGHTS.map((height, i) => (
            <rect
              key={i}
              x={i * 14 + 2}
              y={100 - height}
              width={10}
              height={height}
              rx={2}
              fill="var(--color-pipeline-surface-muted)"
            />
          ))}
        </svg>
      </div>
    </Card>
  );
});

PortfolioPlaceholderCard.displayName = "PortfolioPlaceholderCard";

export default PortfolioPlaceholderCard;
