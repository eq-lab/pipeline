import React from "react";

/**
 * StatusChip — small inline status pill with a leading icon.
 * spec: docs/frontend/ui-components.md#statuschip
 */

export type StatusChipTone = "positive" | "pending" | "neutral";

export interface StatusChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone: StatusChipTone;
  /** Visible status text (e.g. "Payable now"). */
  label: string;
}

const rootClasses = [
  "inline-flex items-center gap-1",
  "px-2 py-0.5",
  "rounded-[var(--radius-pipeline-pill)]",
  "whitespace-nowrap",
  "font-[family-name:var(--font-body)]",
  "text-[length:var(--text-pipeline-caption)]",
  "leading-[var(--text-pipeline-caption--line-height)]",
].join(" ");

const toneClasses: Record<StatusChipTone, string> = {
  positive:
    "bg-[var(--color-pipeline-positive-secondary)] text-[color:var(--color-pipeline-positive)]",
  pending:
    "bg-[var(--color-pipeline-promo)] text-[color:var(--color-pipeline-pending)]",
  neutral:
    "bg-[var(--color-pipeline-surface-muted)] text-[color:var(--color-pipeline-ink-muted)]",
};

function Icon({ tone }: { tone: StatusChipTone }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
    >
      {tone === "positive" && (
        <path
          d="M2 6.5L5 9.5L10 3"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {tone === "pending" && (
        <>
          <circle
            cx="6"
            cy="6"
            r="4.75"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="M6 3.5V6L7.5 7"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
      {tone === "neutral" && (
        <path
          d="M3 6H9"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

export const StatusChip = React.forwardRef<HTMLSpanElement, StatusChipProps>(
  function StatusChip({ tone, label, className, ...rest }, ref) {
    const composed = [rootClasses, toneClasses[tone], className]
      .filter(Boolean)
      .join(" ");
    return (
      <span ref={ref} data-tone={tone} className={composed} {...rest}>
        <Icon tone={tone} />
        {label}
      </span>
    );
  },
);

StatusChip.displayName = "StatusChip";

export default StatusChip;
