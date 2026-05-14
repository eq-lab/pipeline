import React from "react";

/**
 * CoinIcon — displays a USDC, PLUS-D, or sPLUSD coin icon at a given size.
 *
 * The icons are the blue coin SVGs introduced in issue #100.  All assets
 * embed a rasterised PNG sprite via a base64 `<image>` element, so they
 * are not colour-themeable with `currentColor`; the pixels are baked in.
 *
 * Sizes map to the contexts defined in the Figma spec:
 *   - sm (20 px) — wallet pill / conversion-card row
 *   - md (24 px) — default / general use
 *   - lg (40 px) — DepositHeader hero slot
 *
 * Accessibility: decorative by default (`aria-hidden="true"`).  Pass an
 * explicit `aria-label` to make the icon meaningful to assistive tech.
 */

const USDC_B64 =
  "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";

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
  React.SVGAttributes<SVGSVGElement>,
  "viewBox"
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

export const CoinIcon = React.forwardRef<SVGSVGElement, CoinIconProps>(
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
    const b64 =
      token === "usdc" ? USDC_B64 : token === "splusd" ? SPLUSD_B64 : PLUSD_B64;

    // Decorative by default; becomes meaningful when caller supplies aria-label.
    const isHidden = ariaLabel == null ? true : (ariaHidden ?? false);

    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width={px}
        height={px}
        aria-hidden={isHidden || undefined}
        aria-label={ariaLabel}
        role={ariaLabel != null ? "img" : undefined}
        {...rest}
      >
        <image
          href={`data:image/png;base64,${b64}`}
          x="0"
          y="0"
          width="24"
          height="24"
        />
      </svg>
    );
  },
);

CoinIcon.displayName = "CoinIcon";

export default CoinIcon;
