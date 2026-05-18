import React from "react";
import stripedWalletUrl from "../../assets/illustrations/striped-wallet.svg?url";

/**
 * WalletIllustration — striped line-art wallet decoration.
 *
 * Renders the striped-wallet illustration from Figma frame 1497-94556. The
 * artwork itself ships as `packages/ui/src/assets/illustrations/striped-wallet.svg`
 * (downloaded in Issue #39). Rather than inlining the ~50 stripe paths into a
 * React tree, this component uses a CSS `mask-image` so:
 *
 *   - The illustration is colored via `currentColor`, which lets the `tone`
 *     prop swap the fill between the primary-ink (`primary`) and muted-ink
 *     (`muted`) tokens without duplicating SVG paths.
 *   - The artwork preserves its intrinsic 313.672 × 200 aspect ratio
 *     (~1.5684 : 1) at any rendered width.
 *
 * Sizing: callers control the rendered width via the `width` prop. The height
 * scales proportionally via `aspect-ratio`. The component is purely
 * decorative and always renders with `aria-hidden="true"` — meaning is
 * conveyed by the surrounding card (Connect Wallet promo) or empty-state
 * copy (Recent activity).
 *
 * Reuse points:
 *   - Connect Wallet promo card  — large, primary (dark ink) tone.
 *   - Recent activity empty state — smaller, muted tone.
 */

export type WalletIllustrationTone = "primary" | "muted";

export interface WalletIllustrationProps extends Omit<
  React.HTMLAttributes<HTMLSpanElement>,
  "aria-hidden" | "role"
> {
  /**
   * Rendered width in pixels (or any valid CSS length). Height tracks the
   * intrinsic 313.672 × 200 aspect ratio via `aspect-ratio`. Defaults to the
   * Figma intrinsic width of 314 (rounded from 313.672).
   */
  width?: number | string;
  /**
   * Visual emphasis. `primary` paints the strokes in the primary ink token
   * (used by the Connect Wallet promo card). `muted` paints them in the
   * neutral muted ink token (used by the Recent activity empty state).
   */
  tone?: WalletIllustrationTone;
}

// Figma intrinsic dimensions, kept here so the aspect ratio computation has a
// single source of truth.
const INTRINSIC_WIDTH = 313.672;
const INTRINSIC_HEIGHT = 200;
const DEFAULT_WIDTH = Math.round(INTRINSIC_WIDTH);

const toneColors: Record<WalletIllustrationTone, string> = {
  primary: "var(--color-pipeline-ink)",
  muted: "var(--color-pipeline-ink-muted)",
};

export const WalletIllustration = React.forwardRef<
  HTMLSpanElement,
  WalletIllustrationProps
>(function WalletIllustration(
  { width = DEFAULT_WIDTH, tone = "primary", className, style, ...rest },
  ref,
) {
  // Resolve the width into a CSS length: numbers become pixel values, strings
  // pass through untouched so callers can use "100%", "20rem", etc.
  const widthValue = typeof width === "number" ? `${width}px` : width;

  const composedStyle: React.CSSProperties = {
    color: toneColors[tone],
    width: widthValue,
    aspectRatio: `${INTRINSIC_WIDTH} / ${INTRINSIC_HEIGHT}`,
    display: "inline-block",
    // CSS mask paints `currentColor` through the SVG silhouette, so the
    // illustration tracks the `tone` prop via the `color` value above.
    backgroundColor: "currentColor",
    WebkitMaskImage: `url(${stripedWalletUrl})`,
    maskImage: `url(${stripedWalletUrl})`,
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

WalletIllustration.displayName = "WalletIllustration";

export default WalletIllustration;
