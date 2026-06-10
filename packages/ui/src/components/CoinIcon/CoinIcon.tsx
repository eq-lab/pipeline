import React from "react";

// All three tokens render from real vector SVGs via Vite's `?url` import,
// matching the approach used for HeroIcon (Issue #238).
// PLUSD vectorised in Issue #535 (Figma node 910:10281).
import usdcSrc from "../../assets/icons/coin-usdc.svg?url";
import splusdSrc from "../../assets/icons/coin-splusd.svg?url";
import plusdSrc from "../../assets/icons/coin-plusd.svg?url";

/**
 * CoinIcon — displays a USDC, PLUS-D, or sPLUSD coin icon at a given size.
 *
 * All tokens render from vector SVG assets (Issue #246, #534, #535).
 *
 * Sizes map to the contexts defined in the Figma spec:
 *   - sm (20 px) — wallet pill / conversion-card row
 *   - md (24 px) — default / general use
 *   - lg (40 px) — DepositHeader hero slot
 *
 * Accessibility: decorative by default (`aria-hidden="true"`).  Pass an
 * explicit `aria-label` to make the icon meaningful to assistive tech.
 */

const SIZE_MAP: Record<"sm" | "md" | "lg", number> = {
  sm: 20,
  md: 24,
  lg: 40,
};

export interface CoinIconProps extends Omit<
  React.ImgHTMLAttributes<HTMLImageElement>,
  "src" | "width" | "height"
> {
  /** Which coin to display. */
  token: "usdc" | "plusd" | "splusd";
  /**
   * Rendered size.
   * - sm (20 px) — wallet pill / conversion-card row
   * - md (24 px) — default
   * - lg (40 px) — DepositHeader
   */
  size?: "sm" | "md" | "lg";
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

    // "block" is the default display; callers can override it with responsive
    // Tailwind utilities (e.g. className="hidden md:block") because class-based
    // rules share the same specificity and the caller's classes appear later in
    // the stylesheet.  We deliberately do NOT put display in the inline style —
    // inline styles have higher specificity than utility classes, which would
    // prevent responsive hiding from working (Issue #547).
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
