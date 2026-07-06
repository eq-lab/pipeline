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
 *   Right column: Cumulative Yield card — headline value + green bar chart
 *     (no time-range selector — the Figma "Top" frame shows none).
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
import { PanelContainer } from "./PanelContainer";
import { YieldBarChart } from "./YieldBarChart";
import { TvlCard } from "./TvlCard";
import { useYieldHistoryPanel } from "./useYieldHistoryPanel";

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
        // h-[144px] + justify-between: label pinned to the top, value to the
        // bottom (Figma node 3380:1921, 176×144 cards).
        "flex h-[144px] flex-col justify-between p-4",
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
       * heading text. Layout mirrors Figma 3283:67619 (1136×460): two equal
       * 560-wide columns with a 16px gap, stacked below md.
       *   LEFT  (3283:67622): TVL card — spans the full column height, dark
       *     bar chart anchored to the bottom.
       *   RIGHT (3380:1920): vertical stack —
       *     1. Cumulative Yield card (3283:68333, ~300h) — green bars, no tabs.
       *     2. Three metric cards in a row (3380:1921, 144h).
       *   All three metric cards are shown at every viewport (#749 Q3).
       */}
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
          {/*
           * Cumulative Yield card — Figma node 3283:68333. No period tabs per design.
           * Mobile: fixed 248px (Figma 3283:71770). Desktop: fills the right column.
           */}
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
                className="h-[144px] overflow-hidden md:h-auto md:flex-1"
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
               * Seam: empty chart area when no yield data is available (API returned
               * data but all cumulative_yield values are zero). Metric cards still
               * render. Full empty state (all series null) is handled by
               * PanelContainer `state="empty"` above.
               */
              <div
                className="h-[144px] md:h-auto md:flex-1"
                aria-hidden="true"
                data-testid="yield-chart-placeholder"
              />
            )}
          </div>

          {/*
           * Metric cards row — Figma node 3380:1921 (three 176×144 cards, 16px gap).
           * Mobile: overflow-x-auto horizontal scroll so all cards stay reachable.
           * Desktop (md+): three equal flex-1 cards filling the right column.
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
               * renders "—" (surface only backend-served data). Wire once #738 lands.
               */}
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
