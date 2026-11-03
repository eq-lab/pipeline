import React from "react";

/**
 * InfoRow — label-on-left, value-on-right row.
 * spec: docs/frontend/ui-components.md#inforow
 */

export interface InfoRowProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Left-side caption (e.g. "Exchange rate", "Network fee"). */
  label: string;
  /** Right-side value (e.g. "1 USDC = 1 PLUSD", "~$1.20"). */
  value: React.ReactNode;
  /** Lets a long label wrap onto extra lines while the value stays on the right. */
  wrapLabel?: boolean;
}

const rootClasses = [
  "flex items-center justify-between",
  "w-full",
  "font-[family-name:var(--font-body)]",
  "gap-2",
].join(" ");

const labelClasses = [
  "text-[length:var(--text-pipeline-body)]",
  "leading-[var(--text-pipeline-body--line-height)]",
  "text-[color:var(--color-pipeline-ink-muted)]",
].join(" ");

const valueClasses = [
  "text-[length:var(--text-pipeline-body)]",
  "leading-[var(--text-pipeline-body--line-height)]",
  "text-[color:var(--color-pipeline-ink)]",
  "text-right",
  "whitespace-nowrap",
].join(" ");

const wrapValueClasses = "shrink-0";

export const InfoRow = React.forwardRef<HTMLDivElement, InfoRowProps>(
  function InfoRow(
    { label, value, wrapLabel = false, className, ...rest },
    ref,
  ) {
    const composed = [rootClasses, className].filter(Boolean).join(" ");
    // Stable test id derived from the label; a caller-supplied data-testid
    // (via ...rest) still wins.
    const derivedTestId = `info-row-${label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")}`;

    return (
      <div ref={ref} data-testid={derivedTestId} className={composed} {...rest}>
        <span
          className={`${labelClasses} ${wrapLabel ? "min-w-0" : "whitespace-nowrap"}`}
        >
          {label}
        </span>
        <span
          className={`${valueClasses} ${wrapLabel ? wrapValueClasses : ""}`.trim()}
        >
          {value}
        </span>
      </div>
    );
  },
);

InfoRow.displayName = "InfoRow";

export default InfoRow;
