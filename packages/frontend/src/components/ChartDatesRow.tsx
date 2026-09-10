// spec: docs/frontend/dashboard-components.md#chartdatesrow (X-axis row,
// Figma nodes 6002:9267 / 6002:9279, #1133; widened to 5 labels per #1234 —
// below md only the first/middle/last render, per the mobile-polish decision).

const labelClasses = [
  "font-[family-name:var(--font-body)]",
  "text-[length:var(--text-pipeline-caption)]",
  "leading-[var(--text-pipeline-caption--line-height)]",
  "font-normal",
  "text-[color:var(--color-pipeline-ink-muted)]",
  "max-w-[20%] overflow-hidden text-ellipsis whitespace-nowrap",
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
        const isEndpointOrCentre =
          i === 0 ||
          i === labels.length - 1 ||
          i === Math.floor(labels.length / 2);
        const visibility = isEndpointOrCentre ? "" : "hidden md:block";
        return (
          <span key={i} className={`${labelClasses} ${align} ${visibility}`}>
            {label}
          </span>
        );
      })}
    </div>
  );
}

export default ChartDatesRow;
