// spec: docs/frontend/dashboard-components.md#chartvalueaxis (Y-axis: three
// text labels, no gridlines/spine; average positioned proportionally per the
// 2026-09-10 resolutions on #1234 — not pinned to the geometric middle).

const labelClasses = [
  "font-[family-name:var(--font-body)]",
  "text-[length:var(--text-pipeline-caption)]",
  "leading-[var(--text-pipeline-caption--line-height)]",
  "font-normal",
  "text-[color:var(--color-pipeline-ink-muted)]",
  "absolute left-0 whitespace-nowrap",
].join(" ");

export interface ChartValueAxisProps {
  maxLabel: string;
  avgLabel: string;
  avgFraction: number;
  bottomLabel: string;
}

export function ChartValueAxis({
  maxLabel,
  avgLabel,
  avgFraction,
  bottomLabel,
}: ChartValueAxisProps) {
  const avgTopPct =
    Math.round((1 - Math.min(1, Math.max(0, avgFraction))) * 10000) / 100;

  return (
    <div className="relative w-[32px] shrink-0" data-testid="chart-value-axis">
      <span
        className={`${labelClasses} top-0`}
        data-testid="chart-value-axis-max"
      >
        {maxLabel}
      </span>
      <span
        className={`${labelClasses} -translate-y-1/2`}
        style={{ top: `${avgTopPct}%` }}
        data-testid="chart-value-axis-avg"
      >
        {avgLabel}
      </span>
      <span
        className={`${labelClasses} bottom-0`}
        data-testid="chart-value-axis-bottom"
      >
        {bottomLabel}
      </span>
    </div>
  );
}

export default ChartValueAxis;
