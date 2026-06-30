import React from "react";

/**
 * PanelLoading — shared "loading" body for Protocol Dashboard panels.
 *
 * Muted "Loading…" copy, mirroring the loading treatment used by the
 * Transactions page (`routes/transactions.tsx`). Pure presentational; the
 * panel that owns the data decides when to render it (via `PanelContainer`'s
 * `state="loading"`). All four panels reuse this so the loading affordance is
 * identical across the dashboard.
 *
 * Token discipline: muted-ink + body type tokens only — no raw colors/sizes.
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
