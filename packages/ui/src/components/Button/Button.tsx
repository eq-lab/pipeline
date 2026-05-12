import React from "react";

/**
 * Button — Pipeline UI primitive.
 *
 * Three variants, matching the Figma frame 1497-94556:
 *   - `primary-dark`  — black filled rectangle (e.g. "Connect Wallet" in header)
 *   - `primary-blue`  — navy/cobalt filled rectangle (e.g. "Connect", "Convert")
 *   - `circular-blue` — round navy/cobalt CTA (e.g. "Stake")
 *
 * All variants use design tokens from `@pipeline/ui/styles/theme.css`
 * (no raw colors). Label uses the Body Emphasized type style (Graphik LC
 * 16/22, weight 600). Focus-visible rings use `--color-pipeline-brand` for
 * dark/blue rectangles and `--color-pipeline-ink` for the circular variant
 * (which sits on a light card), so the ring always has sufficient contrast.
 */

export type ButtonVariant = "primary-dark" | "primary-blue" | "circular-blue";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

// Shared style applied across all variants. Kept terse intentionally — most
// chrome lives in the variant-specific blocks below.
const baseClasses = [
  "inline-flex items-center justify-center",
  "cursor-pointer select-none",
  "font-[family-name:var(--font-body)]",
  "text-[length:var(--text-pipeline-body)]",
  "leading-[var(--text-pipeline-body--line-height)]",
  "font-[var(--font-weight-emphasized)]",
  "text-[color:var(--color-pipeline-on-dark)]",
  "transition-[background-color,box-shadow,opacity] duration-150 ease-out",
  "focus:outline-none",
  "focus-visible:outline-none",
  "focus-visible:ring-2 focus-visible:ring-offset-2",
  "focus-visible:ring-offset-[var(--color-pipeline-paper)]",
  "disabled:cursor-not-allowed disabled:opacity-50",
].join(" ");

const variantClasses: Record<ButtonVariant, string> = {
  // primary-dark — 48px tall rect, ink/CTA background (#262524).
  // Matches "Connect Wallet" header button (data-node-id 1497:94725) and the
  // "Connect" CTA inside the wallet card (data-node-id I1497:94566;1360:49021).
  "primary-dark": [
    "h-12 min-w-12 px-3",
    "rounded-[var(--radius-pipeline-button)]",
    "bg-[var(--color-pipeline-cta)]",
    "hover:bg-[color-mix(in_oklab,var(--color-pipeline-cta)_88%,white)]",
    "active:bg-[color-mix(in_oklab,var(--color-pipeline-cta)_94%,black)]",
    "focus-visible:ring-[var(--color-pipeline-brand)]",
    "disabled:hover:bg-[var(--color-pipeline-cta)]",
  ].join(" "),

  // primary-blue — 48px tall rect, brand/navy background (#000080).
  // Visual sibling of primary-dark; differs only in fill colour.
  // Matches "Connect"/"Convert" CTAs (data-node-id 1497:94689 etc.).
  "primary-blue": [
    "h-12 min-w-12 px-3",
    "rounded-[var(--radius-pipeline-button)]",
    "bg-[var(--color-pipeline-brand)]",
    "hover:bg-[color-mix(in_oklab,var(--color-pipeline-brand)_85%,white)]",
    "active:bg-[color-mix(in_oklab,var(--color-pipeline-brand)_92%,black)]",
    "focus-visible:ring-[var(--color-pipeline-brand)]",
    "disabled:hover:bg-[var(--color-pipeline-brand)]",
  ].join(" "),

  // circular-blue — 128px round CTA, brand/navy background.
  // Matches the "Stake" button (data-node-id 1497:94713).
  "circular-blue": [
    "size-32",
    "rounded-[var(--radius-pipeline-pill)]",
    "bg-[var(--color-pipeline-brand)]",
    "hover:bg-[color-mix(in_oklab,var(--color-pipeline-brand)_85%,white)]",
    "active:bg-[color-mix(in_oklab,var(--color-pipeline-brand)_92%,black)]",
    "focus-visible:ring-[var(--color-pipeline-ink)]",
    "disabled:hover:bg-[var(--color-pipeline-brand)]",
  ].join(" "),
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { variant = "primary-blue", className, type, children, ...rest },
    ref,
  ) {
    const composed = [baseClasses, variantClasses[variant], className]
      .filter(Boolean)
      .join(" ");

    return (
      <button
        ref={ref}
        type={type ?? "button"}
        className={composed}
        data-variant={variant}
        {...rest}
      >
        {/* Inner label wrapper mirrors the Figma "Label" inset (px-2). Keeps
            text optically centered for rectangular variants and provides a
            consistent hit target for the circular variant. */}
        <span className="inline-flex items-center justify-center px-2">
          {children}
        </span>
      </button>
    );
  },
);

Button.displayName = "Button";

export default Button;
