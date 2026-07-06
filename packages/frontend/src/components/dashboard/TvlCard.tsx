/**
 * TvlCard — Protocol Dashboard TVL card (left column of the Figma "Top" row).
 *
 * Renders from data already fetched by `useYieldHistoryPanel`:
 *   - "TVL" eyebrow + headline value (e.g. "$43.1M")
 *   - "Outstanding in Loans" label + value (muted, right-aligned), or "—" when null
 *   - Horizontal progress bar + "X.X% deployed" caption — ratio of two backend-served
 *     values (`outstanding_in_loans / tvl`). Approved exception to the
 *     "no frontend-computed metrics" rule for this ratio-of-served-values visualisation
 *     (issue #760 open-question resolution). Guard: null/zero tvl → empty bar + "—%".
 *   - Dark TVL bar chart (`fill="var(--color-pipeline-ink)"`)
 *
 * One file = one component (FRONTEND.md rule 1). No data fetching — purely
 * presentational (logic lives in `useYieldHistoryPanel`).
 *
 * Figma:
 *   Desktop: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=3283-67622
 *   Tokens: eyebrow/caption = Caption (Graphik LC 12/16); headline = Heading M (Besley 28/36).
 */
import { YieldBarChart } from "./YieldBarChart";
import type { YieldBarPoint } from "@/utils/yieldSeries";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TvlCardProps {
  /** Formatted headline TVL, e.g. "$43.1M". "—" when null. */
  headlineTvl: string;
  /** Formatted outstanding in loans, e.g. "$31.6M". "—" when null. */
  outstandingInLoans: string;
  /**
   * Deployment ratio (0–1) for the progress bar.
   * `null` when tvl is null/zero (divide-by-zero guard) or outstanding is null.
   * Approved client-side computation: ratio of two backend-served values.
   */
  deployedRatio: number | null;
  /** Pre-computed TVL bar chart data, or null when empty. */
  tvlBars: YieldBarPoint[] | null;
}

// ── Shared style classes ──────────────────────────────────────────────────────

const captionClasses = [
  "font-[family-name:var(--font-body)]",
  "text-[length:var(--text-pipeline-caption)]",
  "leading-[var(--text-pipeline-caption--line-height)]",
  "font-normal",
  "text-[color:var(--color-pipeline-ink-muted)]",
].join(" ");

const headlineClasses = [
  "font-[family-name:var(--font-display)]",
  "text-[length:var(--text-pipeline-heading-m-mobile)]",
  "leading-[var(--text-pipeline-heading-m-mobile--line-height)]",
  "md:text-[length:var(--text-pipeline-heading-m)]",
  "md:leading-[var(--text-pipeline-heading-m--line-height)]",
  "font-normal",
  "text-[color:var(--color-pipeline-ink)]",
].join(" ");

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * TVL card — left column of the Figma "Top" row (node `3283:67622`).
 * Pure view: receives all derived values from the panel hook.
 */
export function TvlCard({
  headlineTvl,
  outstandingInLoans,
  deployedRatio,
  tvlBars,
}: TvlCardProps) {
  // Format the deployed percentage caption.
  // `deployedRatio` is null when tvl is null/zero (divide-by-zero guard).
  const deployedCaption =
    deployedRatio !== null
      ? `${(deployedRatio * 100).toFixed(1)}% deployed`
      : "—% deployed";

  // Progress bar fill width (clamped to 0–100%).
  const barFillPercent =
    deployedRatio !== null
      ? Math.min(100, Math.max(0, deployedRatio * 100))
      : 0;

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
        // Mobile: fixed 404px (Figma 3283:71059). Desktop: fills the 460px row.
        "h-[404px] md:h-[460px] md:flex-1",
      ].join(" ")}
      data-testid="dashboard-tvl-card"
      data-node-id="3283:67622"
    >
      {/*
       * Header: "TVL" eyebrow + headline on left, "Outstanding in Loans" + value
       * muted right-aligned on right. Figma node 3283:67623 (528×56, two halves
       * each 264 wide).
       */}
      <div className="flex items-start justify-between gap-4">
        {/* Left half: eyebrow + headline */}
        <div className="flex flex-col gap-1">
          <span className={captionClasses}>TVL</span>
          <span
            className={headlineClasses}
            data-testid="dashboard-tvl-headline"
          >
            {headlineTvl}
          </span>
        </div>

        {/* Right half: "Outstanding in Loans" label + value (muted, right-aligned) */}
        <div className="flex flex-col items-end gap-1">
          <span className={captionClasses}>Outstanding in Loans</span>
          <span
            className={[
              "font-[family-name:var(--font-display)]",
              "text-[length:var(--text-pipeline-heading-m-mobile)]",
              "leading-[var(--text-pipeline-heading-m-mobile--line-height)]",
              "md:text-[length:var(--text-pipeline-heading-m)]",
              "md:leading-[var(--text-pipeline-heading-m--line-height)]",
              "font-normal",
              "text-[color:var(--color-pipeline-ink-muted)]",
            ].join(" ")}
            data-testid="dashboard-tvl-outstanding"
          >
            {outstandingInLoans}
          </span>
        </div>
      </div>

      {/*
       * Progress bar — track + fill (Figma instance 3380:1410, y=64, 528×4).
       * Fill width is `outstanding_in_loans / tvl` (approved exception to the
       * "no frontend-computed metrics" rule — ratio of two backend-served values).
       * When deployedRatio is null (zero/null tvl), the bar shows an empty track.
       *
       * Track: bg-pipeline-line; Fill: bg-pipeline-ink.
       */}
      <div className="flex flex-col gap-1">
        <div
          className="h-[4px] w-full overflow-hidden rounded-full bg-[color:var(--color-pipeline-line)]"
          data-testid="dashboard-tvl-progress-track"
          data-node-id="3380:1410"
          role="presentation"
          aria-hidden="true"
        >
          <div
            className="h-full rounded-full bg-[color:var(--color-pipeline-ink)] transition-all"
            style={{ width: `${barFillPercent}%` }}
            data-testid="dashboard-tvl-progress-fill"
          />
        </div>

        {/* "X.X% deployed" caption — Caption token, muted, centred (Figma 3380:1895) */}
        <span
          className={[captionClasses, "text-center"].join(" ")}
          data-testid="dashboard-tvl-deployed-caption"
          data-node-id="3380:1895"
        >
          {deployedCaption}
        </span>
      </div>

      {/*
       * TVL bar chart — dark (ink) bars, fixed 240px tall anchored to the bottom
       * (`mt-auto`), matching Figma chart container 3283:67630 (240h) on both
       * desktop (3283:67622, 460-tall card) and mobile (3283:71067, 404-tall card).
       * Uses YieldBarChart with fill="var(--color-pipeline-ink)".
       */}
      {tvlBars !== null && tvlBars.length > 0 ? (
        <div
          className="mt-auto h-[240px] overflow-hidden"
          data-testid="dashboard-tvl-chart-container"
        >
          <YieldBarChart
            bars={tvlBars}
            fill="var(--color-pipeline-ink)"
            aria-label={`TVL history: ${headlineTvl}`}
            className="h-full"
          />
        </div>
      ) : (
        <div
          className="mt-auto h-[240px]"
          aria-hidden="true"
          data-testid="dashboard-tvl-chart-placeholder"
        />
      )}
    </div>
  );
}

export default TvlCard;
