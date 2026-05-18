import React from "react";

// USDC now renders from a real vector SVG (eq-lib Figma node 9250:12383) via
// Vite's `?url` import, matching the approach used for HeroIcon (Issue #238).
// PLUSD and sPLUSD remain as base64 PNGs pending a follow-up cleanup
// (see Issue #159 for sPLUSD; PLUSD is similarly stale but out of scope here).
import usdcSrc from "../../assets/icons/coin-usdc.svg?url";

/**
 * CoinIcon — displays a USDC, PLUS-D, or sPLUSD coin icon at a given size.
 *
 * USDC renders from a vector SVG asset (Issue #246). PLUSD and sPLUSD still
 * use rasterised PNG sprites embedded as base64 data URIs (pending cleanup).
 *
 * Sizes map to the contexts defined in the Figma spec:
 *   - sm (20 px) — wallet pill / conversion-card row
 *   - md (24 px) — default / general use
 *   - lg (40 px) — DepositHeader hero slot
 *
 * Accessibility: decorative by default (`aria-hidden="true"`).  Pass an
 * explicit `aria-label` to make the icon meaningful to assistive tech.
 */

const PLUSD_B64 =
  "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";

// NOTE: SPLUSD_B64 is a placeholder using the PLUSD asset until the real
// sPLUSD Figma asset (node 910:10323) can be extracted. See issue #159.
const SPLUSD_B64 = PLUSD_B64;

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
      "aria-label": ariaLabel,
      "aria-hidden": ariaHidden,
      ...rest
    },
    ref,
  ) {
    const px = SIZE_MAP[size];
    const isUsdc = token === "usdc";
    const src = isUsdc
      ? usdcSrc
      : `data:image/png;base64,${token === "splusd" ? SPLUSD_B64 : PLUSD_B64}`;

    // Decorative by default; becomes meaningful when caller supplies aria-label.
    const isHidden = ariaLabel == null ? true : (ariaHidden ?? false);

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
        style={{ display: "block", flexShrink: 0 }}
        {...rest}
      />
    );
  },
);

CoinIcon.displayName = "CoinIcon";

export default CoinIcon;
