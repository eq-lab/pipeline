import React from "react";
import { HeroIcon } from "../HeroIcon/HeroIcon";

/**
 * StakeHeader — centered header displayed above the stake card.
 *
 * Layout (Figma node 1497-95313):
 *   - Vertically-stacked flex column, centred on both axes.
 *   - `HeroIcon` with `icon="chart"` (72×72 px muted-fill circle) above
 *     the heading with a small gap.
 *   - Display-serif heading at `heading-m` scale (28 px / 36 px line-height).
 *   - `mb-8` (32 px) bottom margin keeps the header → card gap consistent
 *     with the Deposit page (Issue #612).
 *
 * Design tokens used:
 *   - `--font-display`                         — Besley serif typeface
 *   - `--font-weight-regular`                  — 400 (Besley Regular, per Figma node 1497-95313)
 *   - `--text-pipeline-heading-m`              — 28 px
 *   - `--text-pipeline-heading-m--line-height` — 36 px
 *   - `--color-pipeline-ink`                   — primary ink colour
 *
 * No raw hex codes, sizes, or hard-coded font names are used outside of token
 * references.
 *
 * Accessibility: the HeroIcon is decorative by default; the heading is a
 * semantic `<h2>` so it integrates correctly into the page heading hierarchy.
 */

export interface StakeHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Heading text rendered below the HeroIcon.
   * Defaults to `"Earn 8.42% p.a."`.
   */
  title?: string;
}

// Root container — centred column, no fixed width so it fills its parent.
// mb-8 (32 px) matches DepositHeader bottom spacing so header → card gap is
// consistent across Stake and Deposit pages (Issue #612).
const rootClasses = ["flex flex-col items-center", "gap-3", "mb-8"].join(" ");

// Heading — display-serif at heading-m scale, regular weight, primary ink.
// Figma node 1497-95313 specifies Besley Regular (font-weight 400), not Bold.
const headingClasses = [
  "font-[family-name:var(--font-display)]",
  "text-[length:var(--text-pipeline-heading-m)]",
  "leading-[var(--text-pipeline-heading-m--line-height)]",
  "font-[var(--font-weight-regular)]",
  "text-[color:var(--color-pipeline-ink)]",
  "text-center",
  "select-none",
].join(" ");

export const StakeHeader = React.forwardRef<HTMLDivElement, StakeHeaderProps>(
  function StakeHeader({ title = "Earn 8.42% p.a.", className, ...rest }, ref) {
    const composed = [rootClasses, className].filter(Boolean).join(" ");

    return (
      <div ref={ref} className={composed} {...rest}>
        {/* HeroIcon with chart glyph — decorative, centred above the heading */}
        <HeroIcon icon="chart" aria-hidden="true" />

        {/* Display-serif heading */}
        <h2 data-testid="stake-header-title" className={headingClasses}>
          {title}
        </h2>
      </div>
    );
  },
);

StakeHeader.displayName = "StakeHeader";

export default StakeHeader;
