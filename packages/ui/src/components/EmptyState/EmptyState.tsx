import React from "react";

/**
 * EmptyState — centred "no data yet" placeholder (illustration + caption slots).
 * spec: docs/frontend/ui-components.md#emptystate
 */

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Illustration rendered above the caption; the slot does not constrain its size. */
  illustration?: React.ReactNode;
  /** Muted caption below the illustration; ReactNode so callers can pass multi-line copy. */
  caption: React.ReactNode;
}

const rootClasses = [
  "flex flex-col items-center justify-center",
  "h-full w-full",
  "text-center",
  "font-[family-name:var(--font-body)]",
].join(" ");

// NB: don't write Tailwind class syntax in comments — the v4 scanner picks it
// up and emits invalid CSS for slash-containing var() names.
const captionClasses = [
  "text-[length:var(--text-pipeline-body)]",
  "leading-[var(--text-pipeline-body--line-height)]",
  "text-[color:var(--color-pipeline-ink-muted)]",
].join(" ");

export const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  function EmptyState({ illustration, caption, className, ...rest }, ref) {
    const composed = [rootClasses, className].filter(Boolean).join(" ");

    return (
      <div ref={ref} className={composed} {...rest}>
        {illustration ? (
          <div aria-hidden="true" className="shrink-0">
            {illustration}
          </div>
        ) : null}
        <div className={captionClasses}>{caption}</div>
      </div>
    );
  },
);

EmptyState.displayName = "EmptyState";

export default EmptyState;
