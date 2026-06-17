import React from "react";

/**
 * InfoRow — label-on-left, value-on-right row.
 *
 * Used for `Exchange rate` and `Network fee` lines at the bottom of the
 * conversion card (Figma node 1498-100130).
 *
 * Layout: horizontal flex row, label in muted ink on the left, value in
 * primary ink on the right, filling the full width.
 */

export interface InfoRowProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Left-side caption (e.g. "Exchange rate", "Network fee"). */
  label: string;
  /** Right-side value (e.g. "1 USDC = 1 PLUSD", "~$1.20"). */
  value: React.ReactNode;
}

const rootClasses = [
  "flex items-center justify-between",
  "w-full",
  "font-[family-name:var(--font-body)]",
  "gap-2",
].join(" ");

const labelClasses = [
  "text-[length:var(--text-pipeline-caption)]",
  "leading-[var(--text-pipeline-caption--line-height)]",
  "text-[color:var(--color-pipeline-ink-muted)]",
  "whitespace-nowrap",
].join(" ");

const valueClasses = [
  "text-[length:var(--text-pipeline-caption)]",
  "leading-[var(--text-pipeline-caption--line-height)]",
  "text-[color:var(--color-pipeline-ink)]",
  "text-right",
  "whitespace-nowrap",
].join(" ");

export const InfoRow = React.forwardRef<HTMLDivElement, InfoRowProps>(
  function InfoRow({ label, value, className, ...rest }, ref) {
    const composed = [rootClasses, className].filter(Boolean).join(" ");
    // Derive a stable test id from the label so the two rows rendered inside a
    // ConversionCard ("Exchange rate" / "Network fee") stay individually
    // addressable. A caller-supplied data-testid (via ...rest) still wins.
    const derivedTestId = `info-row-${label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")}`;

    return (
      <div ref={ref} data-testid={derivedTestId} className={composed} {...rest}>
        <span className={labelClasses}>{label}</span>
        <span className={valueClasses}>{value}</span>
      </div>
    );
  },
);

InfoRow.displayName = "InfoRow";

export default InfoRow;
