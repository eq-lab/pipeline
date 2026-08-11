import React from "react";

/**
 * QuickAmountChip — selectable amount pill used in the conversion card.
 * spec: docs/frontend/ui-components.md#quickamountchip
 */

export interface QuickAmountChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Label text, e.g. "$1,000 (Min)", "$5,000", "Max". */
  label: string;
  /** Whether this chip is currently selected. */
  selected?: boolean;
}

export const QuickAmountChip = React.forwardRef<
  HTMLButtonElement,
  QuickAmountChipProps
>(function QuickAmountChip(
  { label, selected = false, className, onClick, disabled, ...rest },
  ref,
) {
  const chipClasses = [
    // Layout — flex (not inline-flex) so flex-1 from the parent works
    "flex items-center justify-center",
    "h-8 px-2 whitespace-nowrap",
    "rounded-[var(--radius-pipeline-card)]",
    // Background
    "bg-[var(--color-pipeline-surface)]",
    // Typography
    "font-[family-name:var(--font-body)]",
    "text-[length:var(--text-pipeline-caption)]",
    "leading-[var(--text-pipeline-caption--line-height)]",
    "font-[var(--font-weight-regular)]",
    // Text colour
    "text-[color:var(--color-pipeline-ink)]",
    // Interaction
    "cursor-pointer select-none",
    "transition-[color,box-shadow] duration-150 ease-out",
    // Focus-visible ring
    "focus:outline-none focus-visible:outline-none",
    "focus-visible:ring-2 focus-visible:ring-offset-2",
    "focus-visible:ring-[var(--color-pipeline-brand)]",
    "focus-visible:ring-offset-[var(--color-pipeline-paper)]",
    // Disabled
    "disabled:cursor-not-allowed disabled:opacity-50",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      ref={ref}
      type="button"
      className={chipClasses}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      {...rest}
    >
      {label}
    </button>
  );
});

QuickAmountChip.displayName = "QuickAmountChip";

export default QuickAmountChip;
