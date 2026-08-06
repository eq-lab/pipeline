/**
 * TvlCard — Protocol Dashboard TVL card (left column of the Figma "Top" row).
 *
 * spec: docs/frontend/dashboard-components.md#tvlcard
 * (content, deployed-ratio business rule, Figma tokens).
 */
import { YieldBarChart } from "./YieldBarChart";
import type { YieldBarPoint } from "@/utils/yieldSeries";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TvlCardProps {
  /** Formatted headline TVL, e.g. "$43.1M". "—" when null. */
  headlineTvl: string;
  /** Formatted outstanding in loans, e.g. "$31.6M". "—" when null. */
  outstandingInLoans: string;
  /** Deployment ratio (0–1) for the progress bar. spec: docs/frontend/dashboard-components.md#tvlcard */
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
        "h-[404px] md:h-[460px] md:flex-1",
      ].join(" ")}
      data-testid="dashboard-tvl-card"
      data-node-id="3283:67622"
    >
      {/* Header row — spec: docs/frontend/dashboard-components.md#tvlcard (Figma 3283:67623) */}
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

      {/* Progress bar — spec: docs/frontend/dashboard-components.md#tvlcard (deployed-ratio rule) */}
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

        {/* "X.X% deployed" caption (Figma 3380:1895) */}
        <span
          className={[captionClasses, "text-center"].join(" ")}
          data-testid="dashboard-tvl-deployed-caption"
          data-node-id="3380:1895"
        >
          {deployedCaption}
        </span>
      </div>

      {/* TVL bar chart — spec: docs/frontend/dashboard-components.md#tvlcard (Figma 3283:67630) */}
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
