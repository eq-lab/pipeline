import React from "react";
import { ActivityIcon } from "../ActivityIcon/ActivityIcon";
import type { ActivityIconVariant } from "../ActivityIcon/ActivityIcon";

/**
 * ActivityIconName — re-export of the ActivityIcon variant union so callers
 * can import the type directly from this module.
 */
export type ActivityIconName = ActivityIconVariant;

/**
 * ActivityRow — single row in the activity list.
 *
 * Layout: horizontal flex row with a top border separator.
 *   - Leading `ActivityIcon` (40 × 40 ink tile)
 *   - Two-line content block: title (Body 16/22) + timestamp (Caption 12/16)
 *   - Right-aligned `amount` slot (shrink-0) — accepts any `ReactNode` so
 *     callers can pass an `<AmountPill>` (success rows) or a custom two-line
 *     block (stake / unstake / convert / pending rows).
 *
 * `ActivityRow` is intentionally dumb — no per-state styling logic lives here.
 *
 * Acceptance criteria:
 *   - Top border using the secondary border token (`--color-pipeline-line`),
 *     16 px top padding.
 *   - 12 px gap between icon and content; content block uses `flex-1 min-w-0`.
 *   - Title truncates with ellipsis when it overflows.
 *   - Timestamp uses the secondary-ink token (`--color-pipeline-ink-muted`).
 *   - Right slot is right-aligned with `shrink-0`.
 *   - No raw colors or raw sizes.
 *
 * Figma reference: node 1497-94912.
 */

export interface ActivityRowProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Which activity icon to display (re-exported from `ActivityIcon`). */
  icon: ActivityIconName;
  /** Primary text, e.g. "PLUSD → USDC". Truncates with ellipsis on overflow. */
  title: string;
  /** Secondary text, e.g. "Apr 17, 2:17 PM". Uses the secondary-ink token. */
  timestamp: string;
  /**
   * Right-aligned amount slot. Pass an `<AmountPill>` for success rows or a
   * two-line block for stake / unstake / convert / pending rows.
   */
  amount: React.ReactNode;
}

const rootClasses = [
  "flex items-center gap-3",
  "w-full",
  "border-t border-[color:var(--color-pipeline-line)]",
  "pt-4",
].join(" ");

const contentClasses = ["flex-1 min-w-0", "flex flex-col gap-0.5"].join(" ");

const titleClasses = [
  "font-[family-name:var(--font-body)]",
  "text-[length:var(--text-pipeline-body)]",
  "leading-[var(--text-pipeline-body--line-height)]",
  "font-[var(--font-weight-regular)]",
  "text-[color:var(--color-pipeline-ink)]",
  "truncate",
].join(" ");

const timestampClasses = [
  "font-[family-name:var(--font-body)]",
  "text-[length:var(--text-pipeline-caption)]",
  "leading-[var(--text-pipeline-caption--line-height)]",
  "font-[var(--font-weight-regular)]",
  "text-[color:var(--color-pipeline-ink-muted)]",
  "truncate",
].join(" ");

const amountClasses = ["shrink-0 flex items-center justify-end"].join(" ");

export const ActivityRow = React.forwardRef<HTMLDivElement, ActivityRowProps>(
  function ActivityRow(
    { icon, title, timestamp, amount, className, ...rest },
    ref,
  ) {
    const composed = [rootClasses, className].filter(Boolean).join(" ");

    return (
      <div ref={ref} className={composed} {...rest}>
        {/* Leading activity icon */}
        <ActivityIcon icon={icon} aria-hidden="true" />

        {/* Two-line content block */}
        <div className={contentClasses}>
          <span className={titleClasses}>{title}</span>
          <span className={timestampClasses}>{timestamp}</span>
        </div>

        {/* Right-aligned amount slot */}
        <div className={amountClasses}>{amount}</div>
      </div>
    );
  },
);

ActivityRow.displayName = "ActivityRow";

export default ActivityRow;
