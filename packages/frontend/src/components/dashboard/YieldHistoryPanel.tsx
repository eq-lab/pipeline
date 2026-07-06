/**
 * YieldHistoryPanel — Protocol Dashboard "Top" row (Figma frame `3283:67619`).
 *
 * Wires the `useYieldHistoryPanel` logic hook (FRONTEND.md rule 2: view =
 * JSX only). Renders:
 *
 *   Left column (node `3283:67622`): TVL card — headline, Outstanding in Loans,
 *     progress bar ("% deployed"), and dark TVL bar chart.
 *     Backed by `GET /v1/dashboard/summary` + `GET /v1/dashboard/tvl-history`.
 *
 *   Right column: Cumulative Yield card — headline value + green bar chart +
 *     time-range SegmentedTabs selector.
 *     Backed by `GET /v1/dashboard/summary` + `GET /v1/dashboard/yield-history`.
 *
 *   Three metric cards — "Current APY, Net to sPLUSD", "Loan Book Yield",
 *     "Target Net to sPLUSD". The last has no endpoint yet — it renders "—"
 *     (surface only backend-served data); a seam for `#738` is labelled in the code.
 *
 * Data that is NOT served by the API today (by-source cumulative minted split,
 * real-time T-bill accrual, trailing-30d loan/T-bill breakdown) is intentionally
 * omitted — not fabricated. Seams for those series will be wired once #738
 * delivers the backend endpoints.
 *
 * Figma:
 *   Top row:  https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-67619
 *   TVL card: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-67622
 *   Yield:    https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-68333
 *   Mobile:   https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-72387
 */
import { SegmentedTabs } from "@pipeline/ui";
import { PanelContainer } from "./PanelContainer";
import { YieldBarChart } from "./YieldBarChart";
import { TvlCard } from "./TvlCard";
import { useYieldHistoryPanel } from "./useYieldHistoryPanel";
import { STATS_PERIODS } from "@/utils/statsPeriod";

// ── Period tabs ────────────────────────────────────────────────────────────────

// STATS_PERIODS is the canonical period list used by all stats charts.
const PERIOD_TABS = STATS_PERIODS.map((p) => ({ id: p.id, label: p.label }));

// ── Metric card ────────────────────────────────────────────────────────────────
// Figma node 3380:1921 — asymmetric depth border, white surface, 16px padding.
// Matches the inner card treatment in DeploymentMonitorPanel (LoanBookSummary).

interface MetricCardProps {
  label: string;
  value: string;
  "data-testid"?: string;
  "data-node-id"?: string;
}

function MetricCard({
  label,
  value,
  "data-testid": testId,
  "data-node-id": nodeId,
}: MetricCardProps) {
  return (
    <div
      className={[
        "flex flex-col gap-4 p-4",
        "bg-[color:var(--color-pipeline-surface)]",
        "rounded-[var(--radius-pipeline-card)]",
        "border-t border-l border-[color:var(--color-pipeline-line)]",
        "border-r-[3px] border-b-[3px]",
        "border-b-[color:var(--color-pipeline-line)]",
        "border-r-[color:var(--color-pipeline-line)]",
        // Mobile: w-[200px] shrink-0 — fixed 200px, no shrink (row scrolls).
        // Desktop: flex-1 min-w-0 — cards expand to fill equal widths.
        "w-[200px] shrink-0 md:w-auto md:min-w-0 md:flex-1",
      ].join(" ")}
      data-testid={testId}
      data-node-id={nodeId}
    >
      {/* Label — Caption token, muted ink */}
      <span
        className={[
          "font-[family-name:var(--font-body)]",
          "text-[length:var(--text-pipeline-caption)]",
          "leading-[var(--text-pipeline-caption--line-height)]",
          "font-normal",
          "text-[color:var(--color-pipeline-ink-muted)]",
        ].join(" ")}
      >
        {label}
      </span>
      {/* Value — Heading M token, display serif */}
      <span
        className={[
          "font-[family-name:var(--font-display)]",
          "text-[length:var(--text-pipeline-heading-m-mobile)]",
          "leading-[var(--text-pipeline-heading-m-mobile--line-height)]",
          "md:text-[length:var(--text-pipeline-heading-m)]",
          "md:leading-[var(--text-pipeline-heading-m--line-height)]",
          "font-normal",
          "text-[color:var(--color-pipeline-ink)]",
        ].join(" ")}
      >
        {value}
      </span>
    </div>
  );
}

// ── Panel ──────────────────────────────────────────────────────────────────────

export function YieldHistoryPanel() {
  const {
    state,
    periodId,
    setPeriodId,
    cumulativeBars,
    headlineValue,
    tvlBars,
    tvlSummary,
    metricCards,
    errorMessage,
    refetch,
  } = useYieldHistoryPanel();

  return (
    <PanelContainer
      state={state}
      onRetry={refetch}
      errorMessage={errorMessage}
      borderless
      data-testid="dashboard-panel-yield-history"
      data-node-id="3283:68333"
    >
      {/*
       * No section heading — per Figma frame 3283:67619, the "Top" row has no
       * heading text; it is the TVL card + Cumulative Yield card + 3-stat metric
       * cards. PanelContainer's optional `title` prop is omitted here.
       *
       * Layout mirrors Figma frame 3283:67619 (1136×460):
       *   - Two chart cards side-by-side at desktop, stacked at mobile:
       *     1. TVL card (left, node 3283:67622) — dark ink bars.
       *     2. Cumulative Yield card (right, node 3283:68333) — green bars.
       *   - Three metric cards in a horizontally-scrollable row below.
       *     All cards shown at every viewport — hide nothing (#749 Q3).
       */}
      <div className="flex flex-col gap-4">
        {/*
         * Chart cards row — TVL card + Cumulative Yield card.
         * On mobile the cards stack vertically (flex-col).
         * On desktop they sit side-by-side (md:flex-row).
         */}
        <div className="flex flex-col gap-4 md:flex-row">
          {/* TVL card — Figma node 3283:67622 (left column) */}
          <TvlCard
            headlineTvl={tvlSummary.headlineTvl}
            outstandingInLoans={tvlSummary.outstandingInLoans}
            deployedRatio={tvlSummary.deployedRatio}
            tvlBars={tvlBars}
          />

          {/* Cumulative Yield card — Figma node 3283:68333 (right column) */}
          <div
            className={[
              "flex flex-col gap-4 p-4",
              "bg-[color:var(--color-pipeline-surface)]",
              "rounded-[var(--radius-pipeline-card)]",
              "border-t border-l border-[color:var(--color-pipeline-line)]",
              "border-r-[3px] border-b-[3px]",
              "border-b-[color:var(--color-pipeline-line)]",
              "border-r-[color:var(--color-pipeline-line)]",
              "flex-1",
            ].join(" ")}
            data-testid="yield-cumulative-card"
            data-node-id="3283:68333"
          >
            {/* Header: eyebrow label + headline + period tabs */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-1">
                {/* Eyebrow label — Caption token, muted ink */}
                <span
                  className={[
                    "font-[family-name:var(--font-body)]",
                    "text-[length:var(--text-pipeline-caption)]",
                    "leading-[var(--text-pipeline-caption--line-height)]",
                    "font-normal",
                    "text-[color:var(--color-pipeline-ink-muted)]",
                  ].join(" ")}
                >
                  Cumulative Yield
                </span>
                {/* Headline value — Heading M display serif */}
                <span
                  className={[
                    "font-[family-name:var(--font-display)]",
                    "text-[length:var(--text-pipeline-heading-m-mobile)]",
                    "leading-[var(--text-pipeline-heading-m-mobile--line-height)]",
                    "md:text-[length:var(--text-pipeline-heading-m)]",
                    "md:leading-[var(--text-pipeline-heading-m--line-height)]",
                    "font-normal",
                    "text-[color:var(--color-pipeline-ink)]",
                  ].join(" ")}
                  data-testid="yield-headline-value"
                >
                  {headlineValue}
                </span>
              </div>

              {/* Time-range tabs — floating variant, no outer track */}
              <SegmentedTabs
                tabs={PERIOD_TABS}
                activeId={periodId}
                onSelect={setPeriodId}
                variant="floating"
                className="shrink-0"
              />
            </div>

            {/* Chart — green monotonically-increasing bars, Figma node 3283:68337.
              Height h-[144px] matches Figma XS chart container h=144 (#749). */}
            {cumulativeBars !== null && cumulativeBars.length > 0 ? (
              <div
                className="h-[144px] overflow-hidden"
                data-testid="yield-chart-container"
              >
                <YieldBarChart
                  bars={cumulativeBars}
                  aria-label={`Cumulative yield history: ${headlineValue}`}
                  className="h-full"
                />
              </div>
            ) : (
              /*
               * Seam: chart area is empty when no yield data is available.
               * This can happen when the API returns data but all cumulative_yield
               * values are zero (e.g. no yield minted yet). The metric cards still
               * render. Full empty state (all series null) is handled by
               * PanelContainer `state="empty"` above.
               */
              <div
                className="flex h-[144px] items-center justify-center"
                aria-hidden="true"
                data-testid="yield-chart-placeholder"
              />
            )}
          </div>

          {/* Close chart cards row */}
        </div>

        {/*
         * Metric cards row — Figma node 3380:1921 (three-card row).
         * All three cards are shown at every viewport — hide nothing (#749 Q3).
         * Mobile: overflow-x-auto horizontal scroll so all cards remain reachable
         *   when they cannot fit side-by-side in the 370px content area.
         * Desktop (md+): flex-row (3 cards side by side, flex-1 each).
         */}
        <div
          className="overflow-x-auto"
          data-testid="yield-metric-cards-scroll"
        >
          <div
            className="flex min-w-max flex-row gap-4 md:min-w-0"
            data-testid="yield-metric-cards"
          >
            <MetricCard
              label="Current APY, Net to sPLUSD"
              value={metricCards.currentApyNet}
              data-testid="yield-metric-current-apy"
            />
            <MetricCard
              label="Loan Book Yield"
              value={metricCards.loanBookYield}
              data-testid="yield-metric-loan-book-yield"
            />
            {/*
             * TODO(#738): "Target Net to sPLUSD" has no live endpoint yet, so it
             * renders "—" (surface only backend-served data). Wire this metric
             * once the backend follow-up #738 delivers a target APY field.
             */}
            <MetricCard
              label="Target Net to sPLUSD"
              value={metricCards.targetNetApy}
              data-testid="yield-metric-target-net-apy"
            />
          </div>
        </div>
      </div>
    </PanelContainer>
  );
}

export default YieldHistoryPanel;
