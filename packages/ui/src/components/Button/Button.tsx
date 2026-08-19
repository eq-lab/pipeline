import React from "react";

/**
 * Button — Pipeline UI primitive (primary-dark/primary-blue/secondary/circular-blue/toast-action).
 * spec: docs/frontend/ui-components.md#button
 */

export type ButtonVariant =
  | "primary-dark"
  | "primary-blue"
  | "secondary"
  | "circular-blue"
  | "toast-action";

export type ButtonSize = "default" | "compact";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const baseClasses = [
  "inline-flex items-center justify-center",
  "cursor-pointer select-none",
  "font-[family-name:var(--font-body)]",
  "text-[length:var(--text-pipeline-body)]",
  "leading-[var(--text-pipeline-body--line-height)]",
  "font-[var(--font-weight-emphasized)]",
  "transition-[background-color,box-shadow,opacity] duration-150 ease-out",
  "focus:outline-none",
  "focus-visible:outline-none",
  "focus-visible:ring-2 focus-visible:ring-offset-2",
  "focus-visible:ring-offset-[var(--color-pipeline-paper)]",
  "disabled:cursor-not-allowed",
].join(" ");

const variantClasses: Record<ButtonVariant, string> = {
  "primary-dark": [
    "h-12 min-w-12 px-3",
    "rounded-[var(--radius-pipeline-button)]",
    "bg-[var(--color-pipeline-cta)]",
    "text-[color:var(--color-pipeline-on-dark)]",
    "hover:bg-[color-mix(in_oklab,var(--color-pipeline-cta)_88%,white)]",
    "active:bg-[color-mix(in_oklab,var(--color-pipeline-cta)_94%,black)]",
    "focus-visible:ring-[var(--color-pipeline-brand)]",
    "disabled:hover:bg-[var(--color-pipeline-cta)]",
  ].join(" "),

  "primary-blue": [
    "h-12 min-w-12 px-3",
    "rounded-[var(--radius-pipeline-button)]",
    "bg-[var(--color-pipeline-brand)]",
    "text-[color:var(--color-pipeline-on-dark)]",
    "hover:bg-[color-mix(in_oklab,var(--color-pipeline-brand)_85%,white)]",
    "active:bg-[color-mix(in_oklab,var(--color-pipeline-brand)_92%,black)]",
    "focus-visible:ring-[var(--color-pipeline-brand)]",
    "disabled:hover:bg-[var(--color-pipeline-brand)]",
  ].join(" "),

  secondary: [
    "h-12 min-w-12 px-3",
    "rounded-[var(--radius-pipeline-button)]",
    "bg-transparent",
    "text-[color:var(--color-pipeline-ink)]",
    "focus-visible:ring-[var(--color-pipeline-ink)]",
    "disabled:opacity-[0.32]",
  ].join(" "),

  "circular-blue": [
    "size-32",
    "rounded-[var(--radius-pipeline-pill)]",
    "bg-[var(--color-pipeline-brand)]",
    "text-[color:var(--color-pipeline-on-dark)]",
    "hover:bg-[color-mix(in_oklab,var(--color-pipeline-brand)_85%,white)]",
    "active:bg-[color-mix(in_oklab,var(--color-pipeline-brand)_92%,black)]",
    "focus-visible:ring-[var(--color-pipeline-ink)]",
    "disabled:bg-[rgba(184,191,190,0.12)]",
    "disabled:text-[color:var(--color-pipeline-ink-subtle)]",
    "disabled:hover:bg-[rgba(184,191,190,0.12)]",
  ].join(" "),

  "toast-action": [
    "h-8 min-w-8 px-2.5",
    "rounded-[var(--radius-pipeline-button)]",
    "bg-white",
    "text-[color:var(--color-pipeline-ink)]",
    "hover:bg-[color-mix(in_oklab,white_90%,var(--color-pipeline-ink))]",
    "active:bg-[color-mix(in_oklab,white_85%,var(--color-pipeline-ink))]",
    "focus-visible:ring-[var(--color-pipeline-ink)]",
    "focus-visible:ring-offset-0",
    "disabled:opacity-50",
  ].join(" "),
};

const RECTANGULAR_VARIANTS: ReadonlySet<ButtonVariant> = new Set([
  "primary-dark",
  "primary-blue",
  "secondary",
]);

const compactSizeClasses = "!h-8 !min-w-8 !px-1.5";

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { variant = "primary-blue", size, className, type, children, ...rest },
    ref,
  ) {
    const sizeOverride =
      size === "compact" && RECTANGULAR_VARIANTS.has(variant)
        ? compactSizeClasses
        : undefined;

    const composed = [
      baseClasses,
      variantClasses[variant],
      sizeOverride,
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <button
        ref={ref}
        type={type ?? "button"}
        className={composed}
        data-variant={variant}
        data-size={size ?? "default"}
        {...rest}
      >
        <span
          className={`inline-flex items-center justify-center ${size === "compact" ? "px-1" : "px-2"}`}
        >
          {children}
        </span>
      </button>
    );
  },
);

Button.displayName = "Button";

export default Button;
