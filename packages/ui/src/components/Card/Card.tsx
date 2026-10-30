import React from "react";

/**
 * Card — Pipeline UI surface primitive (white/yellow/muted/danger).
 * spec: docs/frontend/ui-components.md#card
 */

export type CardVariant = "white" | "yellow" | "muted" | "danger";

/** Interior padding: none 0 / sm 8 / md 16 / lg 24px (default); "none" = caller owns padding. */
export type CardPadding = "none" | "sm" | "md" | "lg";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  padding?: CardPadding;
}

// Padding and text color are intentionally NOT set here — they live in the
// per-instance maps below to avoid Tailwind v4 equal-specificity conflicts (#357).
const baseClasses = [
  "block",
  "rounded-[var(--radius-pipeline-card)]",
  "border border-solid",
].join(" ");

// The map guarantees exactly one padding utility per card instance — no
// competing same-specificity rule.
const paddingClasses: Record<CardPadding, string> = {
  none: "p-0",
  sm: "p-2",
  md: "p-4",
  lg: "p-6",
};

const variantClasses: Record<CardVariant, string> = {
  white: [
    "bg-[var(--color-pipeline-surface)]",
    "border-[color:var(--color-pipeline-line)]",
    "text-[color:var(--color-pipeline-ink)]",
  ].join(" "),

  yellow: [
    "bg-[var(--color-pipeline-promo)]",
    "border-[color:var(--color-pipeline-line)]",
    "text-[color:var(--color-pipeline-ink)]",
  ].join(" "),

  muted: [
    "bg-[var(--color-pipeline-paper)]",
    "border-[color:var(--color-pipeline-line)]",
    "text-[color:var(--color-pipeline-ink)]",
  ].join(" "),

  // First-class variant (not a caller className override) — see the Tailwind v4
  // specificity note in the spec (#357).
  danger: [
    "bg-[var(--color-pipeline-danger)]",
    "border-[color:var(--color-pipeline-danger)]",
    "text-[color:var(--color-pipeline-on-danger)]",
  ].join(" "),
};

export const Card = React.forwardRef<HTMLDivElement, CardProps>(function Card(
  { variant = "white", padding = "lg", className, children, ...rest },
  ref,
) {
  const composed = [
    baseClasses,
    paddingClasses[padding],
    variantClasses[variant],
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div ref={ref} className={composed} data-variant={variant} {...rest}>
      {children}
    </div>
  );
});

Card.displayName = "Card";

export default Card;
