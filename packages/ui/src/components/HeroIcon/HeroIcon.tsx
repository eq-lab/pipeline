import React from "react";
import arrowClockSrc from "../../assets/icons/arrow-clock.svg?url";
import navStatsSrc from "../../assets/icons/nav-stats.svg?url";

/**
 * HeroIcon — 72×72 muted-fill circle with a 36px ink-tinted icon centered
 * inside. Used as the page-hero badge above the heading (see Activity hero in
 * Figma node 1497-94912).
 *
 * Built as a generic primitive so future page heroes can reuse it by extending
 * the `icon` string-literal union.
 *
 * Visual spec (Figma node 1497-94912):
 *   - 72×72 px circle — `--color-pipeline-surface-muted` background
 *   - 36×36 px icon slot — `--color-pipeline-ink` fill via CSS mask
 *
 * The icon asset uses `fill="currentColor"` so it is tinted by applying a CSS
 * mask and setting `background-color` to the ink token, matching the pattern
 * used by the nav icon buttons (see `IconButton.stories.tsx → MaskIcon`).
 *
 * Accessibility: decorative by default (`aria-hidden="true"`). Pass an
 * explicit `aria-label` to make the element meaningful to assistive tech.
 */

/** String-literal union of supported icon names. Extend as new icons land. */
export type HeroIconName = "arrow-clock" | "chart";

const ICON_SRC_MAP: Record<HeroIconName, string> = {
  "arrow-clock": arrowClockSrc,
  chart: navStatsSrc,
};

export interface HeroIconProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Which icon glyph to render inside the hero circle. */
  icon: HeroIconName;
}

// Outer circle — 72×72 px, muted surface fill, fully rounded.
const circleClasses = [
  "inline-flex items-center justify-center",
  "shrink-0",
  "rounded-[var(--radius-pipeline-pill)]",
  "bg-[color:var(--color-pipeline-surface-muted)]",
].join(" ");

export const HeroIcon = React.forwardRef<HTMLDivElement, HeroIconProps>(
  function HeroIcon(
    {
      icon,
      className,
      "aria-label": ariaLabel,
      "aria-hidden": ariaHidden,
      style,
      ...rest
    },
    ref,
  ) {
    const src = ICON_SRC_MAP[icon];
    const maskImage = `url(${JSON.stringify(src)})`;

    // Decorative by default; becomes meaningful when caller supplies aria-label.
    const isHidden = ariaLabel == null ? true : (ariaHidden ?? false);

    const composed = [circleClasses, className].filter(Boolean).join(" ");

    return (
      <div
        ref={ref}
        className={composed}
        style={{ width: 72, height: 72, ...style }}
        aria-hidden={isHidden || undefined}
        aria-label={ariaLabel}
        role={ariaLabel != null ? "img" : undefined}
        {...rest}
      >
        {/*
         * 36×36 icon rendered via CSS mask so that SVG's fill="currentColor"
         * paths pick up the ink token.  The span sets `color` to the ink token
         * and the mask paints with `background-color: currentColor`.
         */}
        <span
          aria-hidden="true"
          style={{
            display: "inline-block",
            width: 36,
            height: 36,
            backgroundColor: "var(--color-pipeline-ink)",
            WebkitMaskImage: maskImage,
            WebkitMaskRepeat: "no-repeat",
            WebkitMaskPosition: "center",
            WebkitMaskSize: "contain",
            maskImage,
            maskRepeat: "no-repeat",
            maskPosition: "center",
            maskSize: "contain",
          }}
        />
      </div>
    );
  },
);

HeroIcon.displayName = "HeroIcon";

export default HeroIcon;
