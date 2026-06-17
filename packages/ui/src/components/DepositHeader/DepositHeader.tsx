import React from "react";
import { CoinIcon } from "../CoinIcon/CoinIcon";

/**
 * DepositHeader — responsive header displayed above the deposit / conversion card.
 *
 * Two treatments driven by the `md` (768 px) breakpoint:
 *
 * Mobile (< 768 px) — Figma node 1993:7911:
 *   - Full-width flex column, left-aligned (`items-start`).
 *   - Coin icon is **hidden**.
 *   - Heading: `heading-m` 28 px / 36 px, Besley Regular (400).
 *
 * Desktop (≥ 768 px) — Figma node 1498:100130:
 *   - Centered flex column (`items-center`).
 *   - Large PLUSD coin icon (CoinIcon `xl` = 72 px) above the heading.
 *   - Heading: `heading-m` 28 px / 36 px, Besley Regular (400).
 *
 * Design tokens used:
 *   - `--font-display`                        — Besley serif typeface
 *   - `--text-pipeline-heading-m`             — 28 px
 *   - `--text-pipeline-heading-m--line-height` — 36 px
 *   - `--color-pipeline-ink`                  — primary ink colour
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

// Root container — left-aligned on mobile, centred on desktop (md+).
// w-full ensures left-alignment fills the row on mobile.
// mb-8 (32 px) provides the required bottom spacing (fix 2, Issue #595).
const rootClasses = [
  "flex flex-col items-start md:items-center",
  "w-full",
  "gap-3",
  "mb-8",
].join(" ");

// Heading — display-serif at heading-m scale, regular weight (400), primary ink.
// Left-aligned on mobile, centred on desktop (md+).
// Weight is Besley Regular (font-normal) per Figma desktop node 1498:100130 and
// confirmed human answer overriding the plan's Q2.
const headingClasses = [
  "font-[family-name:var(--font-display)]",
  "text-[length:var(--text-pipeline-heading-m)]",
  "leading-[var(--text-pipeline-heading-m--line-height)]",
  "font-normal",
  "text-[color:var(--color-pipeline-ink)]",
  "text-left md:text-center",
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
      {/* PLUSD coin icon — decorative, hidden on mobile, shown at md+ at xl (72 px) */}
      <CoinIcon
        token="plusd"
        size="xl"
        aria-hidden="true"
        className="hidden md:block"
      />

      {/* Display-serif heading */}
      <h2 className={headingClasses}>{title}</h2>
    </div>
  );
});

DepositHeader.displayName = "DepositHeader";

export default DepositHeader;
