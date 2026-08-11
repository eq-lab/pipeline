import React from "react";

/**
 * Stat — "label above value" readout primitive for the dashboard header strip.
 * spec: docs/frontend/ui-components.md#stat
 */

export interface StatProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Small caption shown above the value (e.g. "Exchange rate"). */
  label: string;
  /** Value shown below the label; ReactNode so callers can mix inline formatting. */
  value: React.ReactNode;
  /** Optional icon after the value; prefer `currentColor` SVG so it inherits the value ink. */
  trailingIcon?: React.ReactNode;
}

const rootClasses = [
  "inline-flex flex-col items-end justify-center",
  "text-right",
  "font-[family-name:var(--font-body)]",
].join(" ");

const labelClasses = [
  "text-[length:var(--text-pipeline-caption)]",
  "leading-[var(--text-pipeline-caption--line-height)]",
  "text-[color:var(--color-pipeline-ink-muted)]",
  "whitespace-nowrap",
].join(" ");

const valueRowClasses = [
  "inline-flex items-center justify-end gap-1",
  "min-h-6",
].join(" ");

const valueTextClasses = [
  "text-[length:var(--text-pipeline-body)]",
  "leading-[var(--text-pipeline-body--line-height)]",
  "text-[color:var(--color-pipeline-ink-muted)]",
  "whitespace-nowrap",
].join(" ");

const trailingIconClasses = [
  "inline-flex size-6 items-center justify-center",
  "shrink-0",
].join(" ");

export const Stat = React.forwardRef<HTMLDivElement, StatProps>(function Stat(
  { label, value, trailingIcon, className, ...rest },
  ref,
) {
  const composed = [rootClasses, className].filter(Boolean).join(" ");

  return (
    <div ref={ref} className={composed} {...rest}>
      <span className={labelClasses}>{label}</span>
      <span className={valueRowClasses}>
        <span className={valueTextClasses}>{value}</span>
        {trailingIcon ? (
          <span aria-hidden="true" className={trailingIconClasses}>
            {trailingIcon}
          </span>
        ) : null}
      </span>
    </div>
  );
});

Stat.displayName = "Stat";

export default Stat;
