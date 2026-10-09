// spec: docs/frontend/trustee-flows.md#shared-detail-primitives
import React from "react";

const REFRESH_VIEWBOX = "0 -1.362 33.4739 33.4739";
const REFRESH_PATH =
  "M18.0989 0C26.59 0.000367233 33.4739 6.88385 33.4739 15.375C33.4739 23.8661 26.59 30.7496 18.0989 30.75C13.2432 30.75 8.91186 28.4969 6.09599 24.9844C5.70803 24.4997 5.78609 23.7923 6.27031 23.4038C6.75508 23.0156 7.46383 23.0935 7.85234 23.5781C10.2595 26.5806 13.9549 28.5 18.0989 28.5C25.3473 28.4996 31.2239 22.6235 31.2239 15.375C31.2239 8.12649 25.3473 2.25037 18.0989 2.25C11.3576 2.25 5.80634 7.33285 5.06181 13.875H6.10624L6.58671 13.8779C7.0061 13.885 7.24908 13.9134 7.3997 14.0273C7.57413 14.1595 7.68235 14.3611 7.6956 14.5796C7.7106 14.8309 7.50783 15.1352 7.1038 15.7412L4.84648 19.1279C4.51307 19.628 4.34617 19.8785 4.13603 19.9658C3.95209 20.0421 3.74429 20.0421 3.56035 19.9658C3.35024 19.8784 3.18328 19.628 2.8499 19.1279L0.592573 15.7412C0.188544 15.1352 -0.0142274 14.8309 0.000775896 14.5796C0.0140205 14.3612 0.12228 14.1595 0.296674 14.0273C0.497398 13.8755 0.861979 13.875 1.59013 13.875H2.79716C3.55123 6.08763 10.1137 0 18.0989 0Z";

const DOWNLOAD_VIEWBOX = "0 0 16.6667 16.6667";
const DOWNLOAD_PATH =
  "M8.33333 16.6667C3.73096 16.6667 -4.02352e-07 12.9357 0 8.33333C4.02352e-07 3.73096 3.73096 -4.02352e-07 8.33333 0C12.9357 4.02352e-07 16.6667 3.73096 16.6667 8.33333C16.6667 12.9357 12.9357 16.6667 8.33333 16.6667ZM7.89144 12.1086C8.12028 12.3374 8.48254 12.3519 8.72803 12.1517L8.77523 12.1086L10.8586 10.0252C11.1026 9.78115 11.1026 9.38552 10.8586 9.14144C10.6145 8.89736 10.2188 8.89736 9.97477 9.14144L8.95833 10.1579V5.41667C8.95833 5.07149 8.67851 4.79167 8.33333 4.79167C7.98816 4.79167 7.70833 5.07149 7.70833 5.41667V10.1579L6.69189 9.14144C6.44782 8.89736 6.05218 8.89736 5.80811 9.14144C5.56403 9.38552 5.56403 9.78115 5.80811 10.0252L7.89144 12.1086Z";

const STROKE_VIEWBOX = "0 0 16 16";
const CHECK_PATH = "M3.25 8.5L6.5 11.75L12.75 4.75";
const CROSS_PATH = "M4.25 4.25L11.75 11.75M11.75 4.25L4.25 11.75";

type GlyphProps = React.SVGAttributes<SVGSVGElement> & { size?: number };

function Svg({
  viewBox,
  size,
  children,
  ...rest
}: GlyphProps & { viewBox: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={viewBox}
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function RefreshIcon({ size = 20, ...rest }: GlyphProps) {
  return (
    <Svg viewBox={REFRESH_VIEWBOX} size={size} {...rest}>
      <path d={REFRESH_PATH} fill="currentColor" />
    </Svg>
  );
}

export function DownloadIcon({ size = 18, ...rest }: GlyphProps) {
  return (
    <Svg viewBox={DOWNLOAD_VIEWBOX} size={size} {...rest}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d={DOWNLOAD_PATH}
        fill="currentColor"
      />
    </Svg>
  );
}

export function CheckIcon({ size = 16, ...rest }: GlyphProps) {
  return (
    <Svg viewBox={STROKE_VIEWBOX} size={size} {...rest}>
      <path
        d={CHECK_PATH}
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function CrossIcon({ size = 16, ...rest }: GlyphProps) {
  return (
    <Svg viewBox={STROKE_VIEWBOX} size={size} {...rest}>
      <path
        d={CROSS_PATH}
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
