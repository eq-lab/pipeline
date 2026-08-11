import React from "react";
import stripedWalletUrl from "../../assets/illustrations/striped-wallet.svg?url";

/**
 * WalletIllustration — striped line-art wallet decoration.
 * spec: docs/frontend/ui-components.md#walletillustration
 */

export type WalletIllustrationTone = "primary" | "muted";

export interface WalletIllustrationProps extends Omit<
  React.HTMLAttributes<HTMLSpanElement>,
  "aria-hidden" | "role"
> {
  /** Rendered width (px number or any CSS length); height tracks the intrinsic aspect ratio. */
  width?: number | string;
  /** Visual emphasis: `primary` (dark ink) or `muted` (muted ink). */
  tone?: WalletIllustrationTone;
}

// Intrinsic SVG dimensions — single source of truth for the aspect ratio.
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
  // Numbers become pixel values; strings ("100%", "20rem", …) pass through.
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
