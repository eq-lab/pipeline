// spec: docs/frontend/ui-components.md#warningillustration
import React from "react";
import stripedWarningUrl from "../../assets/illustrations/striped-warning.svg?url";

export type WarningIllustrationTone = "primary" | "muted";

export interface WarningIllustrationProps extends Omit<
  React.HTMLAttributes<HTMLSpanElement>,
  "aria-hidden" | "role"
> {
  width?: number | string;
  tone?: WarningIllustrationTone;
}

const DEFAULT_WIDTH = 236;
const ASPECT_RATIO = "236 / 236";

const toneColors: Record<WarningIllustrationTone, string> = {
  primary: "var(--color-pipeline-ink)",
  muted: "var(--color-pipeline-ink-muted)",
};

export const WarningIllustration = React.forwardRef<
  HTMLSpanElement,
  WarningIllustrationProps
>(function WarningIllustration(
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
    WebkitMaskImage: `url(${stripedWarningUrl})`,
    maskImage: `url(${stripedWarningUrl})`,
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

WarningIllustration.displayName = "WarningIllustration";

export default WarningIllustration;
