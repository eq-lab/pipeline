import React from "react";

/**
 * PanelLoading — shared "loading" body for Protocol Dashboard panels.
 * spec: docs/frontend/dashboard-components.md#panel-states
 */
export type PanelLoadingProps = React.HTMLAttributes<HTMLDivElement>;

const loadingClasses = [
  "text-[length:var(--text-pipeline-body)]",
  "leading-[var(--text-pipeline-body--line-height)]",
  "text-[color:var(--color-pipeline-ink-muted)]",
].join(" ");

export function PanelLoading({ className, ...rest }: PanelLoadingProps) {
  const composed = [loadingClasses, className].filter(Boolean).join(" ");
  return (
    <div className={composed} {...rest}>
      Loading…
    </div>
  );
}

export default PanelLoading;
