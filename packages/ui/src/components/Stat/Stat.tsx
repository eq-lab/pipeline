import React from "react";

/**
 * Stat — Pipeline UI readout primitive.
 *
 * Small "label above value" readout used in the dashboard header strip
 * (Figma frame 1497-94556 → nodes 1497:94561 "Exchange rate",
 * 1497:94562 "Total Value Locked", 1497:94563 "Current APY"). One of the
 * stats in the strip is paired with an external-link icon — Stat exposes an
 * optional `trailingIcon` slot rendered inline after the value so callers
 * can compose that pairing without a wrapping element.
 *
 * Layout matches the Figma node `Content` (e.g. I1497:94561;8901:3390):
 *   - Two-row stack, right-aligned, baseline-free (each row owns its
 *     own line-height so the rows align visually with the icon).
 *   - Label row: 12 / 16 body, muted ink.
 *   - Value row: 16 / 22 body, muted ink, optional 24×24 trailing icon
 *     rendered to the right with 4px gap (matches Figma `TitleCont` gap).
 *
 * The component is a pure readout — it owns typography and alignment only.
 * No surface fill, border, or padding (the parent strip handles the
 * dividing left border, see node 1497:94562). All visual values come from
 * the design tokens declared in `@pipeline/ui/styles/theme.css`.
 */

export interface StatProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Small caption shown above the value (e.g. "Exchange rate"). */
  label: string;
  /**
   * Value shown below the label (e.g. "1 sPLUSD = 1.0234 PLUSD"). Accepts a
   * ReactNode so callers can mix in inline formatting (units, deltas) while
   * keeping the typography token consistent.
   */
  value: React.ReactNode;
  /**
   * Optional 24×24 icon rendered to the right of the value. Used by the
   * APY stat in the Figma header strip which pairs with an external-link
   * affordance. Prefer SVG that paints with `currentColor` so the icon
   * inherits the value's ink colour.
   */
  trailingIcon?: React.ReactNode;
}

// Outer stack — matches Figma `Content` node (right-aligned, two rows).
const rootClasses = [
  "inline-flex flex-col items-end justify-center",
  "text-right",
  "font-[family-name:var(--font-body)]",
].join(" ");

// Label row — caption size, muted ink. min-h-[16px] keeps the row stable when
// the label is short (mirrors Figma min-w-full / line-height behaviour).
const labelClasses = [
  "text-[length:var(--text-pipeline-caption)]",
  "leading-[var(--text-pipeline-caption--line-height)]",
  "text-[color:var(--color-pipeline-ink-muted)]",
  "whitespace-nowrap",
].join(" ");

// Value row — body size, muted ink. min-h-[24px] mirrors Figma `TitleCont`
// (node I1497:94561;8901:3392) so the strip baselines stay aligned even when
// the value is short.
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

// Fixed 24×24 trailing icon slot — matches the Figma icon container so layout
// is stable regardless of which icon node is supplied.
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
