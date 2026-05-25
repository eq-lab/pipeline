import React from "react";

/**
 * QuickAmountChip — selectable amount pill used in the conversion card.
 *
 * Renders as a `<button type="button">` white rounded-rectangle chip with a
 * 1px hairline border. Matches Figma node 1498-99888 ("suggestion bar chip")
 * in file A43rjYYjSwdTmiwwf5cx5n.
 *
 * Variants:
 *   - Default: unselected state with muted ink label
 *   - Selected: filled with surface and primary ink
 *   - Special label: "Max" (same visual, semantic distinction in label only)
 *
 * Design tokens used:
 *   - `--color-pipeline-surface`      — chip fill (white on gray container)
 *   - `--color-pipeline-line`         — 1px hairline border around each chip
 *   - `--radius-pipeline-button`      — corner radius (~4px rounded rectangle)
 *   - `--color-pipeline-paper`        — paper background (focus ring offset)
 *   - `--color-pipeline-ink`          — selected label colour
 *   - `--color-pipeline-ink-muted`    — unselected label colour
 *   - `--color-pipeline-brand`        — focus-visible ring
 *   - `--font-body`, `--text-pipeline-body`, `--font-weight-emphasized`
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
    // Layout — flex so flex-1 from parent works correctly
    "flex items-center justify-center",
    "h-8 px-2 whitespace-nowrap",
    "rounded-[var(--radius-pipeline-button)]",
    // Background — white chip with hairline border on gray container
    "bg-[var(--color-pipeline-surface)]",
    "border border-[var(--color-pipeline-line)]",
    // Typography
    "font-[family-name:var(--font-body)]",
    "text-[length:var(--text-pipeline-body)]",
    "leading-[var(--text-pipeline-body--line-height)]",
    "font-[var(--font-weight-emphasized)]",
    // Text colour
    selected
      ? "text-[color:var(--color-pipeline-ink)]"
      : "text-[color:var(--color-pipeline-ink-muted)]",
    // Interaction
    "cursor-pointer select-none",
    "transition-[color,box-shadow] duration-150 ease-out",
    // Hover — intensify text when unselected
    !selected && !disabled
      ? "hover:text-[color:var(--color-pipeline-ink)]"
      : "",
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
