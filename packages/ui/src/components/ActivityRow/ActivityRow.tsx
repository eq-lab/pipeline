import React from "react";
import { ActivityIcon } from "../ActivityIcon/ActivityIcon";
import type {
  ActivityIconVariant,
  ActivityIconTone,
} from "../ActivityIcon/ActivityIcon";

/** Re-export of the ActivityIcon variant union for direct import from this module. */
export type ActivityIconName = ActivityIconVariant;

/** Re-export of the ActivityIcon tone union for direct import from this module. */
export type ActivityRowTone = ActivityIconTone;

/**
 * ActivityRow — single row in the activity list (icon + title/timestamp + amount slot).
 * spec: docs/frontend/ui-components.md#activityrow
 */

export interface ActivityRowProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Which activity icon to display (re-exported from `ActivityIcon`). */
  icon: ActivityIconName;
  /** Tonal variant forwarded to `ActivityIcon`. @default "neutral" */
  tone?: ActivityRowTone;
  /** Primary text, e.g. "PLUSD → USDC". Truncates with ellipsis on overflow. */
  title: string;
  /** Secondary text, e.g. "Apr 17, 2:17 PM". Uses the secondary-ink token. */
  timestamp: string;
  /** Right-aligned amount slot; accepts any ReactNode (e.g. an `<AmountPill>`). */
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
    { icon, tone = "neutral", title, timestamp, amount, className, ...rest },
    ref,
  ) {
    const composed = [rootClasses, className].filter(Boolean).join(" ");

    return (
      <div ref={ref} className={composed} {...rest}>
        <ActivityIcon icon={icon} tone={tone} aria-hidden="true" />

        <div className={contentClasses}>
          <span className={titleClasses}>{title}</span>
          <span className={timestampClasses}>{timestamp}</span>
        </div>

        <div className={amountClasses}>{amount}</div>
      </div>
    );
  },
);

ActivityRow.displayName = "ActivityRow";

export default ActivityRow;
