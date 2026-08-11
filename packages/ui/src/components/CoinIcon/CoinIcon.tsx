import React from "react";

import usdcSrc from "../../assets/icons/coin-usdc.svg?url";
import splusdSrc from "../../assets/icons/coin-splusd.svg?url";
import plusdSrc from "../../assets/icons/coin-plusd.svg?url";

/**
 * CoinIcon — USDC, PLUSD, or sPLUSD coin icon at a fixed size (sm/md/lg/xl).
 * spec: docs/frontend/ui-components.md#coinicon
 */

const SIZE_MAP: Record<"sm" | "md" | "lg" | "xl", number> = {
  sm: 20,
  md: 24,
  lg: 40,
  xl: 72,
};

export interface CoinIconProps extends Omit<
  React.ImgHTMLAttributes<HTMLImageElement>,
  "src" | "width" | "height"
> {
  /** Which coin to display. */
  token: "usdc" | "plusd" | "splusd";
  /** Rendered size: sm 20 / md 24 (default) / lg 40 / xl 72 px. */
  size?: "sm" | "md" | "lg" | "xl";
}

export const CoinIcon = React.forwardRef<HTMLImageElement, CoinIconProps>(
  function CoinIcon(
    {
      token,
      size = "md",
      className,
      "aria-label": ariaLabel,
      "aria-hidden": ariaHidden,
      ...rest
    },
    ref,
  ) {
    const px = SIZE_MAP[size];
    const isUsdc = token === "usdc";
    const isSplusd = token === "splusd";
    const src =
      isUsdc ? usdcSrc
      : isSplusd ? splusdSrc
      : plusdSrc;

    // Decorative by default; becomes meaningful when caller supplies aria-label.
    const isHidden = ariaLabel == null ? true : (ariaHidden ?? false);

    // Display stays a class, never an inline style — inline style would beat
    // responsive utilities like "hidden md:block" (Issue #547).
    const composedClassName = ["block", className].filter(Boolean).join(" ");

    return (
      <img
        ref={ref}
        src={src}
        width={px}
        height={px}
        alt={ariaLabel ?? ""}
        aria-hidden={isHidden || undefined}
        aria-label={ariaLabel}
        role={ariaLabel != null ? "img" : undefined}
        className={composedClassName}
        style={{ flexShrink: 0 }}
        {...rest}
      />
    );
  },
);

CoinIcon.displayName = "CoinIcon";

export default CoinIcon;
