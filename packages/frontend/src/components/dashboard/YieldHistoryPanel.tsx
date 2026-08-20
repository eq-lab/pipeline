/**
 * YieldHistoryPanel — Protocol Dashboard "Top" row (Figma frame `3283:67619`).
 *
 * spec: docs/frontend/dashboard-components.md#yieldhistorypanel
 * (layout, data sourcing, omitted-data rationale, Figma bindings).
 */
import { PanelContainer } from "./PanelContainer";
import { YieldBarChart } from "./YieldBarChart";
import { ChartDatesRow } from "../ChartDatesRow";
import { formatAxisDateRange } from "@/utils/formatDate";
import { TvlCard } from "./TvlCard";
import { useYieldHistoryPanel } from "./useYieldHistoryPanel";

// ── Metric card ────────────────────────────────────────────────────────────────
// spec: docs/frontend/dashboard-components.md#yieldhistorypanel (metric card Figma tokens)
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
        "flex h-[144px] flex-col justify-between p-4",
        "bg-[color:var(--color-pipeline-surface)]",
        "rounded-[var(--radius-pipeline-card)]",
        "border-t border-l border-[color:var(--color-pipeline-line)]",
        "border-r-[3px] border-b-[3px]",
        "border-b-[color:var(--color-pipeline-line)]",
        "border-r-[color:var(--color-pipeline-line)]",
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
      {/* No section heading (Figma 3283:67619) — spec: docs/frontend/dashboard-components.md#yieldhistorypanel */}
      <div className="flex flex-col gap-4 md:h-[460px] md:flex-row">
        {/* LEFT column — TVL card (Figma 3283:67622); fills the full column height. */}
        <TvlCard
          headlineTvl={tvlSummary.headlineTvl}
          outstandingInLoans={tvlSummary.outstandingInLoans}
          deployedRatio={tvlSummary.deployedRatio}
          tvlBars={tvlBars}
        />

        {/* RIGHT column (Figma 3380:1920) — Cumulative Yield card + metric cards. */}
        <div className="flex flex-col gap-4 md:flex-1">
          {/* Cumulative Yield card (Figma 3283:68333, no period tabs) */}
          <div
            className={[
              "flex h-[248px] flex-col gap-4 p-4 md:h-auto md:flex-1",
              "bg-[color:var(--color-pipeline-surface)]",
              "rounded-[var(--radius-pipeline-card)]",
              "border-t border-l border-[color:var(--color-pipeline-line)]",
              "border-r-[3px] border-b-[3px]",
              "border-b-[color:var(--color-pipeline-line)]",
              "border-r-[color:var(--color-pipeline-line)]",
            ].join(" ")}
            data-testid="yield-cumulative-card"
            data-node-id="3283:68333"
          >
            {/* Header: eyebrow label + headline (Figma 3283:68334 — no tabs). */}
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

            {/* Chart — green bars (Figma 3283:68337). Mobile: 144px; desktop: fills. */}
            {cumulativeBars !== null && cumulativeBars.length > 0 ? (
              <div
                className="flex flex-col md:h-auto md:flex-1"
                data-node-id="6002:9279"
              >
                <div
                  className="h-[128px] overflow-hidden md:h-auto md:flex-1"
                  data-testid="yield-chart-container"
                >
                  <YieldBarChart
                    bars={cumulativeBars}
                    aria-label={`Cumulative yield history: ${headlineValue}`}
                    className="h-full"
                  />
                </div>
                <ChartDatesRow
                  {...formatAxisDateRange(
                    cumulativeBars[0]!.timestamp,
                    cumulativeBars[cumulativeBars.length - 1]!.timestamp,
                  )}
                />
              </div>
            ) : (
              // Empty chart seam — spec: docs/frontend/dashboard-components.md#yieldhistorypanel
              <div
                className="h-[144px] md:h-auto md:flex-1"
                aria-hidden="true"
                data-testid="yield-chart-placeholder"
              />
            )}
          </div>

          {/* Metric cards row (Figma 3380:1921) — spec: docs/frontend/dashboard-components.md#yieldhistorypanel */}
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
              {/* Static product constant — spec: docs/frontend/dashboard-components.md#yieldhistorypanel. TODO(#738) */}
              <MetricCard
                label="Target Net to sPLUSD"
                value={metricCards.targetNetApy}
                data-testid="yield-metric-target-net-apy"
              />
            </div>
          </div>
        </div>
      </div>
    </PanelContainer>
  );
}

export default YieldHistoryPanel;
