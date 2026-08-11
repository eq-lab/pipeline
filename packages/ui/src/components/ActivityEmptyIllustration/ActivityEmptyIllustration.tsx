import React from "react";
import stripedActivityEmptyUrl from "../../assets/illustrations/striped-activity-empty.svg?url";

/**
 * ActivityEmptyIllustration — striped square silhouette for the Recent-activity empty state.
 * spec: docs/frontend/ui-components.md#activityemptyillustration
 */

export type ActivityEmptyIllustrationTone = "primary" | "muted";

export interface ActivityEmptyIllustrationProps extends Omit<
  React.HTMLAttributes<HTMLSpanElement>,
  "aria-hidden" | "role"
> {
  /** Width as px number or any CSS length; height tracks the 1 / 1 aspect ratio. Default 240. */
  width?: number | string;
  /** `muted` (default) — muted-ink strokes; `primary` — primary-ink strokes. */
  tone?: ActivityEmptyIllustrationTone;
}

// Intrinsic width of the square (1 / 1) artwork.
const DEFAULT_WIDTH = 240;

const toneColors: Record<ActivityEmptyIllustrationTone, string> = {
  primary: "var(--color-pipeline-ink)",
  muted: "var(--color-pipeline-ink-muted)",
};

export const ActivityEmptyIllustration = React.forwardRef<
  HTMLSpanElement,
  ActivityEmptyIllustrationProps
>(function ActivityEmptyIllustration(
  { width = DEFAULT_WIDTH, tone = "muted", className, style, ...rest },
  ref,
) {
  // Numbers become px; strings ("100%", "20rem") pass through untouched.
  const widthValue = typeof width === "number" ? `${width}px` : width;

  const composedStyle: React.CSSProperties = {
    color: toneColors[tone],
    width: widthValue,
    aspectRatio: "1 / 1",
    display: "inline-block",
    // CSS mask paints `currentColor` through the SVG silhouette, so the
    // illustration tracks the `tone` prop via the `color` value above.
    backgroundColor: "currentColor",
    WebkitMaskImage: `url(${stripedActivityEmptyUrl})`,
    maskImage: `url(${stripedActivityEmptyUrl})`,
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskPosition: "center",
    maskPosition: "center",
    WebkitMaskSize: "contain",
    maskSize: "contain",
    ...style,
  };

  return (
    <span
      ref={ref}
      aria-hidden="true"
      data-tone={tone}
      className={className}
      style={composedStyle}
      {...rest}
    />
  );
});

ActivityEmptyIllustration.displayName = "ActivityEmptyIllustration";

export default ActivityEmptyIllustration;
