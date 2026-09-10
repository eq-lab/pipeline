// spec: docs/frontend/dashboard-components.md#chartvalueaxis (Y-axis: three
// text labels at top / fixed middle / bottom, no gridlines/spine; middle tick
// is max/2 per the 2026-09-10 change on #1234).

const labelClasses = [
  "font-[family-name:var(--font-body)]",
  "text-[length:var(--text-pipeline-caption)]",
  "leading-[var(--text-pipeline-caption--line-height)]",
  "font-normal",
  "text-[color:var(--color-pipeline-ink-muted)]",
  "whitespace-nowrap",
].join(" ");

export interface ChartValueAxisProps {
  maxLabel: string;
  midLabel: string;
  bottomLabel: string;
}

export function ChartValueAxis({
  maxLabel,
  midLabel,
  bottomLabel,
}: ChartValueAxisProps) {
  return (
    <div
      className="flex w-[32px] shrink-0 flex-col items-start justify-between"
      data-testid="chart-value-axis"
    >
      <span className={labelClasses} data-testid="chart-value-axis-max">
        {maxLabel}
      </span>
      <span className={labelClasses} data-testid="chart-value-axis-mid">
        {midLabel}
      </span>
      <span className={labelClasses} data-testid="chart-value-axis-bottom">
        {bottomLabel}
      </span>
    </div>
  );
}

export default ChartValueAxis;
