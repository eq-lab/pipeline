// spec: docs/frontend/ui-components.md#checkillustration
import React from "react";
import stripedCheckUrl from "../../assets/illustrations/striped-check.svg?url";

export type CheckIllustrationTone = "primary" | "muted";

export interface CheckIllustrationProps extends Omit<
  React.HTMLAttributes<HTMLSpanElement>,
  "aria-hidden" | "role"
> {
  width?: number | string;
  tone?: CheckIllustrationTone;
}

const DEFAULT_WIDTH = 291;
const ASPECT_RATIO = "291 / 193.66";

const toneColors: Record<CheckIllustrationTone, string> = {
  primary: "var(--color-pipeline-ink)",
  muted: "var(--color-pipeline-ink-muted)",
};

export const CheckIllustration = React.forwardRef<
  HTMLSpanElement,
  CheckIllustrationProps
>(function CheckIllustration(
  { width = DEFAULT_WIDTH, tone = "muted", className, style, ...rest },
  ref,
) {
  const widthValue = typeof width === "number" ? `${width}px` : width;

  const composedStyle: React.CSSProperties = {
    color: toneColors[tone],
    width: widthValue,
    aspectRatio: ASPECT_RATIO,
    display: "inline-block",
    backgroundColor: "currentColor",
    WebkitMaskImage: `url(${stripedCheckUrl})`,
    maskImage: `url(${stripedCheckUrl})`,
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

CheckIllustration.displayName = "CheckIllustration";

export default CheckIllustration;
