/**
 * YieldHistoryPanel — Protocol Dashboard Panel D: Yield History.
 *
 * Wires the `useYieldHistoryPanel` logic hook (FRONTEND.md rule 2: view =
 * JSX only). Renders:
 *
 *   1. "Cumulative Yield" card — headline value + green bar chart + time-range
 *      SegmentedTabs selector. Backed by `GET /v1/stats/yield`.
 *   2. Three metric cards — "Current APY, Net to sPLUSD", "Loan Book Yield",
 *      "Target Net to sPLUSD". The last is a static product constant (8–12%);
 *      a seam for `#738` is labelled in the code.
 *
 * Data that is NOT served by the API today (by-source cumulative minted split,
 * real-time T-bill accrual, trailing-30d loan/T-bill breakdown) is intentionally
 * omitted — not fabricated. Seams for those series will be wired once #738
 * delivers the backend endpoints.
 *
 * Figma:
 *   Desktop: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-68333
 *   Mobile:  https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-72387
 */
import { SegmentedTabs } from "@pipeline/ui";
import { PanelContainer } from "./PanelContainer";
import { YieldBarChart } from "./YieldBarChart";
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
        "border-b-[3px] border-r-[3px]",
        "border-b-[color:var(--color-pipeline-line)]",
        "border-r-[color:var(--color-pipeline-line)]",
        "flex-1 min-w-0",
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
       * No section heading — per Figma frame 3283:67619, the Yield History
       * section has no heading text; it is just the Cumulative Yield card +
       * the 3-stat metric cards grid. PanelContainer's optional `title` prop
       * is omitted here.
       *
       * Layout mirrors the Figma frame (3283:67619 right column):
       *   - Cumulative Yield card at the top (3283:68333).
       *   - Three metric cards in a responsive row below.
       *     Desktop: 3 columns side-by-side.
       *     Mobile (3283-72387): stacked single column.
       */}
      <div className="flex flex-col gap-6">
        {/* Cumulative Yield card — Figma node 3283:68333 */}
        <div
          className={[
            "flex flex-col gap-4 p-4",
            "bg-[color:var(--color-pipeline-surface)]",
            "rounded-[var(--radius-pipeline-card)]",
            "border-t border-l border-[color:var(--color-pipeline-line)]",
            "border-b-[3px] border-r-[3px]",
            "border-b-[color:var(--color-pipeline-line)]",
            "border-r-[color:var(--color-pipeline-line)]",
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

          {/* Chart — green monotonically-increasing bars, Figma node 3283:68337 */}
          {cumulativeBars !== null && cumulativeBars.length > 0 ? (
            <div className="h-[120px] overflow-hidden" data-testid="yield-chart-container">
              <YieldBarChart
                bars={cumulativeBars}
                aria-label={`Cumulative yield history: ${headlineValue}`}
                className="h-full"
              />
            </div>
          ) : (
            /*
             * Seam: chart area is empty when no yield data is available.
             * This can happen when the API returns data but all accrued values
             * are zero (e.g. no active loans yet). The metric cards still render.
             * Full empty state (vault = zero-address or all series null) is
             * handled by PanelContainer `state="empty"` above.
             */
            <div
              className="h-[120px] flex items-center justify-center"
              aria-hidden="true"
              data-testid="yield-chart-placeholder"
            />
          )}
        </div>

        {/*
         * Metric cards row — Figma node 3380:1921 (three-card row).
         * Desktop: flex-row (3 cards side by side).
         * Mobile: flex-col (stacked, per Figma node 3283-72387).
         */}
        <div
          className="flex flex-col gap-3 sm:flex-row"
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
           * TODO(#738): "Target Net to sPLUSD" is the static product constant
           * "8–12%". No live endpoint serves a decomposed target APY today.
           * Wire this metric once the backend follow-up #738 delivers the field.
           */}
          <MetricCard
            label="Target Net to sPLUSD"
            value={metricCards.targetNetApyStatic}
            data-testid="yield-metric-target-net-apy"
          />
        </div>
      </div>
    </PanelContainer>
  );
}

export default YieldHistoryPanel;
