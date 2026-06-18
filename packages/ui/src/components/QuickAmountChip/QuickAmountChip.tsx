import React from "react";

/**
 * QuickAmountChip — selectable amount pill used in the conversion card.
 *
 * Renders as a `<button type="button">` slightly-rounded rectangle chip
 * without a border. Matches Figma node 1497-95326 ("suggestion bar chip") in
 * file A43rjYYjSwdTmiwwf5cx5n which uses `radius-s` = 4px (Issue #614).
 *
 * Variants:
 *   - Default: unselected state with primary ink label (no border)
 *   - Selected: filled with surface and primary ink
 *   - Special label: "Max" (same visual, semantic distinction in label only)
 *
 * Design tokens used:
 *   - `--color-pipeline-surface`      — chip fill (white on gray container)
 *   - `--radius-pipeline-card`        — 4px radius (radius-s per Figma)
 *   - `--color-pipeline-paper`        — paper background (focus ring offset)
 *   - `--color-pipeline-ink`          — label colour (selected and unselected)
 *   - `--color-pipeline-brand`        — focus-visible ring
 *   - `--font-body`, `--text-pipeline-caption`, `--font-weight-regular`
 */

export interface QuickAmountChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Label text, e.g. "$1,000 (Min)", "$5,000", "Max". Whole-dollar amounts omit the ".00" suffix. */
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
    // 4px radius (radius-s) per Figma node 1497-95326 (Issue #614)
    "rounded-[var(--radius-pipeline-card)]",
    // Background — white chip, no border (Issue #595)
    "bg-[var(--color-pipeline-surface)]",
    // Typography — caption size (12px), regular weight (Issue #595)
    "font-[family-name:var(--font-body)]",
    "text-[length:var(--text-pipeline-caption)]",
    "leading-[var(--text-pipeline-caption--line-height)]",
    "font-[var(--font-weight-regular)]",
    // Text colour — primary ink for both selected and unselected (Issue #595)
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
