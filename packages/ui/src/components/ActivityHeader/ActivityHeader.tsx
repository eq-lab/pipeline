import React from "react";
import { HeroIcon } from "../HeroIcon/HeroIcon";

/**
 * ActivityHeader — responsive header displayed above the transaction list on
 * the Activity page.
 *
 * Two treatments driven by the `md` (768 px) breakpoint:
 *
 * Mobile (< 768 px) — Figma node 1993-9592:
 *   - Full-width flex column, left-aligned (`items-start`).
 *   - `HeroIcon` with `icon="arrow-clock"` is **hidden**.
 *   - Heading: `heading-m` 28 px / 36 px, Besley Regular (400), left-aligned.
 *
 * Desktop (≥ 768 px) — Figma node 1497-94912:
 *   - Centered flex column (`items-center`).
 *   - `HeroIcon` with `icon="arrow-clock"` (72×72 px muted-fill circle) above
 *     the heading.
 *   - Heading: `heading-m` 28 px / 36 px, Besley Regular (400), centered.
 *
 * Design tokens used:
 *   - `--font-display`                         — Besley serif typeface
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

export interface ActivityHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Heading text rendered below the HeroIcon.
   * Defaults to `"Activity"`.
   */
  title?: string;
}

// Root container — left-aligned on mobile, centred on desktop (md+).
// w-full ensures left-alignment fills the row on mobile.
const rootClasses = [
  "flex flex-col items-start md:items-center",
  "w-full",
  "gap-3",
].join(" ");

// Heading — display-serif at heading-m scale, regular weight (400), primary ink.
// Left-aligned on mobile, centred on desktop (md+).
// Weight is Besley Regular (font-normal) matching DepositHeader per maintainer
// confirmation ("regular at both") — applies to both mobile and desktop breakpoints.
const headingClasses = [
  "font-[family-name:var(--font-display)]",
  "text-[length:var(--text-pipeline-heading-m)]",
  "leading-[var(--text-pipeline-heading-m--line-height)]",
  "font-normal",
  "text-[color:var(--color-pipeline-ink)]",
  "text-left md:text-center",
  "select-none",
].join(" ");

export const ActivityHeader = React.forwardRef<
  HTMLDivElement,
  ActivityHeaderProps
>(function ActivityHeader({ title = "Activity", className, ...rest }, ref) {
  const composed = [rootClasses, className].filter(Boolean).join(" ");

  return (
    <div ref={ref} className={composed} {...rest}>
      {/* HeroIcon with arrow-clock glyph — decorative, hidden on mobile, shown at md+ */}
      <HeroIcon
        icon="arrow-clock"
        aria-hidden="true"
        className="hidden md:block"
      />

      {/* Display-serif heading */}
      <h2 className={headingClasses}>{title}</h2>
    </div>
  );
});

ActivityHeader.displayName = "ActivityHeader";

export default ActivityHeader;
