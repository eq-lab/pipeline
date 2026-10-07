// spec: docs/frontend/ui-components.md#signupillustration
import React from "react";
import stripedSignupUrl from "../../assets/illustrations/striped-signup.svg?url";

export type SignUpIllustrationTone = "primary" | "muted";

export interface SignUpIllustrationProps extends Omit<
  React.HTMLAttributes<HTMLSpanElement>,
  "aria-hidden" | "role"
> {
  width?: number | string;
  tone?: SignUpIllustrationTone;
}

const DEFAULT_WIDTH = 288;
const ASPECT_RATIO = "288 / 288";

const toneColors: Record<SignUpIllustrationTone, string> = {
  primary: "var(--color-pipeline-ink)",
  muted: "var(--color-pipeline-ink-muted)",
};

export const SignUpIllustration = React.forwardRef<
  HTMLSpanElement,
  SignUpIllustrationProps
>(function SignUpIllustration(
  { width = DEFAULT_WIDTH, tone = "primary", className, style, ...rest },
  ref,
) {
  const widthValue = typeof width === "number" ? `${width}px` : width;

  const composedStyle: React.CSSProperties = {
    color: toneColors[tone],
    width: widthValue,
    aspectRatio: ASPECT_RATIO,
    display: "inline-block",
    backgroundColor: "currentColor",
    WebkitMaskImage: `url(${stripedSignupUrl})`,
    maskImage: `url(${stripedSignupUrl})`,
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

SignUpIllustration.displayName = "SignUpIllustration";

export default SignUpIllustration;
