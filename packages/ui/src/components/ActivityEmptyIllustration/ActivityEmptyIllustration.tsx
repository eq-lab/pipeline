import React from "react";
import stripedActivityEmptyUrl from "../../assets/illustrations/striped-activity-empty.svg";

/**
 * ActivityEmptyIllustration — striped square silhouette for the Recent-activity
 * empty state.
 *
 * Renders the striped-square illustration from Figma node `1497:94570`
 * (file `A43rjYYjSwdTmiwwf5cx5n`). The artwork ships as
 * `packages/ui/src/assets/illustrations/striped-activity-empty.svg`
 * (downloaded in Issue #202). Rather than inlining the ~90 stroke paths into a
 * React tree, this component uses a CSS `mask-image` so:
 *
 *   - The illustration is colored via `currentColor`, which lets the `tone`
 *     prop swap the fill between the primary-ink (`primary`) and muted-ink
 *     (`muted`) tokens without duplicating SVG paths.
 *   - The artwork preserves its intrinsic 240 × 240 aspect ratio (`1 / 1`)
 *     at any rendered width.
 *
 * Intrinsic size: 240 × 240 px (`aspect-ratio: 1 / 1`). Default `width` is
 * 240 to match the Figma `IMG` slot in the Recent-activity `Placeholder`
 * frame.
 *
 * This component is distinct from `WalletIllustration` (Figma node
 * `1497:94556`, 313.672 × 200 landscape striped wallet with a coin-slot
 * detail). Use `WalletIllustration` for the Connect Wallet promo card;
 * use this component for the Recent-activity empty state.
 *
 * Tone prop semantics:
 *   - `muted` (default) — paints strokes in the neutral muted-ink token
 *     (`--color-pipeline-ink-muted`). This is the production use for the
 *     Recent-activity empty state.
 *   - `primary` — paints strokes in the primary ink token
 *     (`--color-pipeline-ink`). Available for future surfaces that may need
 *     a high-contrast variant of the same silhouette.
 *
 * Accessibility: the component is purely decorative. It renders with
 * `aria-hidden="true"` and conveys no meaning by itself — meaning is
 * provided by the surrounding `EmptyState` caption.
 *
 * Reuse points:
 *   - Recent activity empty state (Figma node `1497:94570`) — muted tone,
 *     width 240.
 */

export type ActivityEmptyIllustrationTone = "primary" | "muted";

export interface ActivityEmptyIllustrationProps extends Omit<
  React.HTMLAttributes<HTMLSpanElement>,
  "aria-hidden" | "role"
> {
  /**
   * Rendered width in pixels (or any valid CSS length). Height tracks the
   * intrinsic 1 / 1 aspect ratio via `aspect-ratio`. Defaults to the Figma
   * intrinsic width of 240.
   */
  width?: number | string;
  /**
   * Visual emphasis. `muted` (default) paints the strokes in the neutral
   * muted-ink token — used by the Recent activity empty state. `primary`
   * paints them in the primary ink token for high-contrast placement.
   */
  tone?: ActivityEmptyIllustrationTone;
}

// Figma intrinsic dimensions (square, 240 × 240). Aspect ratio is 1 / 1.
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
  // Resolve the width into a CSS length: numbers become pixel values, strings
  // pass through untouched so callers can use "100%", "20rem", etc.
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
