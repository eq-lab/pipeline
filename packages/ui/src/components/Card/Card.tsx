import React from "react";

/**
 * Card — Pipeline UI surface primitive.
 *
 * Two variants from Figma frame 1497-94556:
 *   - `white`  — paper-white surface with a subtle hairline border. Used for
 *                Get PLUSD, Stake, Earned, Recent activity, QnA cards, and the
 *                outer container that wraps the dashboard.
 *   - `yellow` — pale yellow promo surface used for the Connect Wallet card on
 *                the left of the dashboard.
 *
 * The Card is a pure surface — it controls fill, border, radius and inner
 * padding only. Children render unstyled so callers compose their own layout
 * (heading rows, value stacks, CTAs, etc.) on top of the surface.
 *
 * All visual values come from design tokens declared in
 * `@pipeline/ui/styles/theme.css` (no raw colors).
 */

export type CardVariant = "white" | "yellow";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
}

// Shared surface chrome. Padding and radius mirror the Figma card frames
// (24px inner padding, 4px corner radius from --radius-pipeline-card).
const baseClasses = [
  "block",
  "rounded-[var(--radius-pipeline-card)]",
  "p-6",
  "border border-solid",
  "text-[color:var(--color-pipeline-ink)]",
].join(" ");

const variantClasses: Record<CardVariant, string> = {
  // white — #ffffff surface with hairline border in --color-pipeline-line.
  // Matches every neutral card on the dashboard (e.g. Get PLUSD card node
  // 1497:94567, Stake card 1497:94707, outer container 1497:94565).
  white: [
    "bg-[var(--color-pipeline-surface)]",
    "border-[color:var(--color-pipeline-line)]",
  ].join(" "),

  // yellow — pale yellow promo surface. The background token already includes
  // the 16% alpha used in Figma; the border is the same hairline so the card
  // sits visually alongside the white surfaces.
  // Matches the Connect Wallet promo card (node 1497:94688).
  yellow: [
    "bg-[var(--color-pipeline-promo)]",
    "border-[color:var(--color-pipeline-line)]",
  ].join(" "),
};

export const Card = React.forwardRef<HTMLDivElement, CardProps>(function Card(
  { variant = "white", className, children, ...rest },
  ref,
) {
  const composed = [baseClasses, variantClasses[variant], className]
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
