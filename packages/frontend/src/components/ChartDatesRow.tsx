// spec: docs/frontend/dashboard-components.md#chartdatesrow (X-axis row,
// Figma nodes 6002:9267 / 6002:9279, #1133; widened to 5 labels per #1234).

const labelClasses = [
  "font-[family-name:var(--font-body)]",
  "text-[length:var(--text-pipeline-caption)]",
  "leading-[var(--text-pipeline-caption--line-height)]",
  "font-normal",
  "text-[color:var(--color-pipeline-ink-muted)]",
  "w-[44px] overflow-hidden text-ellipsis whitespace-nowrap",
].join(" ");

export function ChartDatesRow({ labels }: { labels: string[] }) {
  return (
    <div
      className="flex h-4 w-full items-center justify-between"
      data-testid="chart-dates-row"
    >
      {labels.map((label, i) => {
        const align =
          i === 0
            ? "text-left"
            : i === labels.length - 1
              ? "text-right"
              : "text-center";
        return (
          <span key={i} className={`${labelClasses} ${align}`}>
            {label}
          </span>
        );
      })}
    </div>
  );
}

export default ChartDatesRow;
