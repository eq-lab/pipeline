import React from "react";

/**
 * AmountPill — static, non-interactive ink-filled pill.
 *
 * Displays a formatted amount string (e.g. `+500.00 USDC`) inside a
 * fully-rounded pill with an ink fill and white (on-dark) text.  Used on
 * the right side of success transaction rows.
 *
 * This component is intentionally non-interactive: it renders as a `<span>`
 * and has no hover, focus, or disabled state.  Use `Button` for clickable
 * pill-shaped controls.
 *
 * Figma reference: node 1497-94912.
 *
 * Design tokens used:
 *   - `--color-pipeline-ink`     — ink fill background
 *   - `--color-pipeline-on-dark` — white text on ink background
 *   - `--radius-pipeline-card`   — 4 px corner radius (per Figma)
 *   - `--font-body`              — Graphik LC body typeface
 *   - `--text-pipeline-body`     — 16 px body size
 *   - `--font-weight-emphasized` — 600 semi-bold weight
 */

export interface AmountPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  /**
   * The amount text to display inside the pill, e.g. `"+500.00 USDC"`.
   */
  children: React.ReactNode;
}

const pillClasses = [
  // Layout
  "inline-flex items-center justify-center",
  "px-3 py-1",
  // Shape
  "rounded-[var(--radius-pipeline-card)]",
  // Background — ink fill
  "bg-[var(--color-pipeline-ink)]",
  // Typography
  "font-[family-name:var(--font-body)]",
  "text-[length:var(--text-pipeline-body)]",
  "leading-[var(--text-pipeline-body--line-height)]",
  "font-[var(--font-weight-emphasized)]",
  // Text — on-dark (white)
  "text-[color:var(--color-pipeline-on-dark)]",
  // Prevent text selection / ensure inline presentation
  "whitespace-nowrap select-none",
].join(" ");

export const AmountPill = React.forwardRef<HTMLSpanElement, AmountPillProps>(
  function AmountPill({ children, className, ...rest }, ref) {
    const composed = [pillClasses, className].filter(Boolean).join(" ");

    return (
      <span ref={ref} className={composed} {...rest}>
        {children}
      </span>
    );
  },
);

AmountPill.displayName = "AmountPill";

export default AmountPill;
