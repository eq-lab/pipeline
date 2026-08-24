import React from "react";
import arrowClockSrc from "../../assets/icons/arrow-clock.svg?url";
import navStatsSrc from "../../assets/icons/nav-stats.svg?url";

/**
 * HeroIcon — circular page-hero icon badge.
 * spec: docs/frontend/ui-components.md#heroicon
 */

/** String-literal union of supported icon names. Extend as new icons land. */
export type HeroIconName = "arrow-clock" | "chart";

const ICON_SRC_MAP: Record<HeroIconName, string> = {
  "arrow-clock": arrowClockSrc,
  chart: navStatsSrc,
};

const ICON_TINT = "var(--color-pipeline-ink-subtle)";

export interface HeroIconProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Which icon glyph to render inside the hero circle. */
  icon: HeroIconName;
}

const circleClasses = [
  "inline-flex items-center justify-center",
  "shrink-0",
  "rounded-[var(--radius-pipeline-pill)]",
  "bg-[color:var(--color-pipeline-fill-muted)]",
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
    const tint = ICON_TINT;
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
        {/* CSS mask tints the fill="currentColor" asset via background-color. */}
        <span
          aria-hidden="true"
          style={{
            display: "inline-block",
            width: 36,
            height: 36,
            backgroundColor: tint,
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
