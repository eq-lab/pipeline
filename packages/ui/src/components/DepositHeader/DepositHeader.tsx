import React from "react";
import { CoinIcon } from "../CoinIcon/CoinIcon";

/**
 * DepositHeader — centered header displayed above the deposit / conversion card.
 *
 * Layout (Figma node 1498-100130):
 *   - Vertically-stacked flex column, centred on both axes.
 *   - Large PLUSD coin icon (CoinIcon `lg` = 40 px) with a small gap above the
 *     heading.
 *   - Display-serif heading at `heading-m` scale (28 px / 36 px line-height) —
 *     visibly smaller than the dashboard's "Welcome" heading (64 px / title).
 *
 * Design tokens used:
 *   - `--font-display`                  — Besley serif typeface
 *   - `--font-weight-bold`              — 700
 *   - `--text-pipeline-heading-m`       — 28 px
 *   - `--text-pipeline-heading-m--line-height` — 36 px
 *   - `--color-pipeline-ink`            — primary ink colour
 *
 * No raw hex codes, sizes, or hard-coded font names are used outside of token
 * references.
 *
 * Accessibility: the coin icon is decorative (`aria-hidden="true"` by default
 * in CoinIcon); the heading is a semantic `<h2>` so it integrates correctly
 * into the page heading hierarchy beneath the dashboard's `<h1>`.
 */

export interface DepositHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Heading text rendered below the coin icon.
   * Defaults to `"1:1 Conversion"`.
   */
  title?: string;
}

// Root container — centred column, no fixed width so it fills its parent.
const rootClasses = ["flex flex-col items-center", "gap-3"].join(" ");

// Heading — display-serif at heading-m scale, bold weight, primary ink.
// Matches Figma text style for the DepositHeader label.
const headingClasses = [
  "font-[family-name:var(--font-display)]",
  "text-[length:var(--text-pipeline-heading-m)]",
  "leading-[var(--text-pipeline-heading-m--line-height)]",
  "font-[var(--font-weight-bold)]",
  "text-[color:var(--color-pipeline-ink)]",
  "text-center",
  "select-none",
].join(" ");

export const DepositHeader = React.forwardRef<
  HTMLDivElement,
  DepositHeaderProps
>(function DepositHeader(
  { title = "1:1 Conversion", className, ...rest },
  ref,
) {
  const composed = [rootClasses, className].filter(Boolean).join(" ");

  return (
    <div ref={ref} className={composed} {...rest}>
      {/* Large PLUSD coin icon — decorative, centred above the heading */}
      <CoinIcon token="plusd" size="lg" aria-hidden="true" />

      {/* Display-serif heading */}
      <h2 className={headingClasses}>{title}</h2>
    </div>
  );
});

DepositHeader.displayName = "DepositHeader";

export default DepositHeader;
