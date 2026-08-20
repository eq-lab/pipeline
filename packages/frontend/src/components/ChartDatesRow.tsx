// spec: docs/frontend/dashboard-components.md#chartdatesrow (endpoint-date x-axis row,
// Figma nodes 6002:9267 / 6002:9279, #1133).

const labelClasses = [
  "font-[family-name:var(--font-body)]",
  "text-[length:var(--text-pipeline-caption)]",
  "leading-[var(--text-pipeline-caption--line-height)]",
  "font-normal",
  "text-[color:var(--color-pipeline-ink-muted)]",
  "min-w-px flex-1 truncate",
].join(" ");

export function ChartDatesRow({ start, end }: { start: string; end: string }) {
  return (
    <div
      className="flex h-4 w-full items-center justify-between whitespace-nowrap"
      data-testid="chart-dates-row"
    >
      <span className={labelClasses}>{start}</span>
      <span className={`${labelClasses} text-right`}>{end}</span>
    </div>
  );
}

export default ChartDatesRow;
