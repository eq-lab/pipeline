import React from "react";

/**
 * Card — Pipeline UI surface primitive.
 *
 * Three variants from Figma:
 *   - `white`  — paper-white surface with a subtle hairline border. Used for
 *                Get PLUSD, Stake, Earned, Recent activity, QnA cards, and the
 *                outer container that wraps the dashboard.
 *                (Figma frame 1497-94556)
 *   - `yellow` — pale yellow promo surface used for the Connect Wallet card on
 *                the left of the dashboard.
 *                (Figma frame 1497-94556)
 *   - `muted`  — slightly-grey surface used for step rows in the deposit/
 *                conversion flow. Background is `--color-pipeline-paper`
 *                (#f8f7f6). Used by `StepsCard`.
 *                (Figma node 1498-100130)
 *
 * The Card is a pure surface — it controls fill, border, radius and inner
 * padding only. Children render unstyled so callers compose their own layout
 * (heading rows, value stacks, CTAs, etc.) on top of the surface.
 *
 * All visual values come from design tokens declared in
 * `@pipeline/ui/styles/theme.css` (no raw colors).
 */

export type CardVariant = "white" | "yellow" | "muted";

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

  // muted — slightly-grey surface (#f8f7f6) used for the step rows in the
  // deposit/conversion flow. Uses --color-pipeline-paper so the card
  // visually recedes behind white surfaces. Hairline border from
  // --color-pipeline-line for consistency.
  // Matches the StepsCard container (Figma node 1498-100130).
  muted: [
    "bg-[var(--color-pipeline-paper)]",
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
