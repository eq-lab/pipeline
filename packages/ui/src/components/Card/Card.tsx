import React from "react";

/**
 * Card — Pipeline UI surface primitive.
 *
 * Four variants from Figma:
 *   - `white`  — paper-white surface with a subtle hairline border. Used for
 *                Get PLUSD, Stake, Earned, Recent activity, QnA cards, and the
 *                outer container that wraps the dashboard.
 *                (Figma frame 1497-94556)
 *   - `yellow` — pale yellow promo surface (#F8FCE9) used for the Connect
 *                Wallet banner on the deposit/stake pages and the home
 *                dashboard. Matches the solid Figma value (issue #606).
 *                (Figma frame 1497-94556)
 *   - `muted`  — slightly-grey surface used for step rows in the deposit/
 *                conversion flow. Background is `--color-pipeline-paper`
 *                (#f8f7f6). Used by `StepsCard`.
 *                (Figma node 1498-100130)
 *   - `danger` — red danger surface used for error/unreachable banners.
 *                Background is `--color-pipeline-danger` (#c0392b) with white
 *                text (`--color-pipeline-on-danger`) and a matching red border.
 *                Use this variant instead of appending Tailwind color classes to
 *                avoid Tailwind v4 equal-specificity conflicts (see Issue #357).
 *
 * The Card is a pure surface — it controls fill, border, radius and inner
 * padding only. Children render unstyled so callers compose their own layout
 * (heading rows, value stacks, CTAs, etc.) on top of the surface.
 *
 * All visual values come from design tokens declared in
 * `@pipeline/ui/styles/theme.css` (no raw colors).
 *
 * ## Padding
 *
 * The `padding` prop controls interior padding as a first-class variant to
 * avoid Tailwind v4 equal-specificity conflicts (Issue #357). Padding is NOT
 * in `baseClasses`; it is injected from the `paddingClasses` map so there is
 * no same-specificity competitor that a caller className could lose to.
 *
 *   - `"none"` — 0px (`p-0`). Used when the caller manages all internal
 *               padding via child elements (e.g. multi-section cards where
 *               each section has its own padding).
 *   - `"sm"` — 8px  (`p-2`). Used by mobile home small cards (StartHere,
 *               Earned, Stake) per Figma frame `1989:8292`.
 *   - `"md"` — 16px (`p-4`). Used by mobile home promo card
 *               (ConnectWalletPromoCard) per Figma frame `1989:8292`.
 *   - `"lg"` — 24px (`p-6`). Default; matches every desktop card and all
 *               consumers that don't pass an explicit padding value.
 */

export type CardVariant = "white" | "yellow" | "muted" | "danger";

/**
 * Controls interior padding as a first-class variant (avoids Tailwind v4
 * equal-specificity hazard documented in Issue #357).
 * - `"none"` = 0px  (`p-0`) — caller owns all internal padding
 * - `"sm"` = 8px  (`p-2`)
 * - `"md"` = 16px (`p-4`)
 * - `"lg"` = 24px (`p-6`) — default; preserves all existing consumer behavior
 */
export type CardPadding = "none" | "sm" | "md" | "lg";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  padding?: CardPadding;
}

// Shared surface chrome. Radius mirrors the Figma card frames
// (4px corner radius from --radius-pipeline-card).
// Padding is NOT included here — it lives in paddingClasses so it can be
// overridden safely without hitting Tailwind v4 equal-specificity conflicts.
// Note: text color is intentionally NOT set here — it lives in each variant so
// the danger variant can override it without hitting Tailwind v4 equal-
// specificity conflicts.
const baseClasses = [
  "block",
  "rounded-[var(--radius-pipeline-card)]",
  "border border-solid",
].join(" ");

// Padding as a first-class variant map. Each key corresponds to a CardPadding
// value. Using a map (like variantClasses) ensures there is exactly one padding
// utility per card instance — no competing same-specificity rule.
const paddingClasses: Record<CardPadding, string> = {
  none: "p-0", // 0px  — caller owns all internal padding (multi-section cards)
  sm: "p-2", // 8px  — mobile home small cards
  md: "p-4", // 16px — mobile home promo card
  lg: "p-6", // 24px — desktop default (all existing consumers)
};

const variantClasses: Record<CardVariant, string> = {
  // white — #ffffff surface with hairline border in --color-pipeline-line.
  // Matches every neutral card on the dashboard (e.g. Get PLUSD card node
  // 1497:94567, Stake card 1497:94707, outer container 1497:94565).
  white: [
    "bg-[var(--color-pipeline-surface)]",
    "border-[color:var(--color-pipeline-line)]",
    "text-[color:var(--color-pipeline-ink)]",
  ].join(" "),

  // yellow — pale yellow promo surface. Background is --color-pipeline-promo
  // (#F8FCE9 — the solid Figma value from issue #606); border is the same
  // hairline so the card sits visually alongside the white surfaces.
  // Matches the Connect Wallet promo card (node 1497:94688).
  yellow: [
    "bg-[var(--color-pipeline-promo)]",
    "border-[color:var(--color-pipeline-line)]",
    "text-[color:var(--color-pipeline-ink)]",
  ].join(" "),

  // muted — slightly-grey surface (#f8f7f6) used for the step rows in the
  // deposit/conversion flow. Uses --color-pipeline-paper so the card
  // visually recedes behind white surfaces. Border colour from
  // --color-pipeline-line. Note: StepsCard overrides individual side widths
  // to produce the asymmetric 1px top/left + 3px right/bottom effect from
  // Figma node 1498-100130; generic muted cards keep a uniform 1px border.
  // Matches the StepsCard container (Figma node 1498-100130).
  muted: [
    "bg-[var(--color-pipeline-paper)]",
    "border-[color:var(--color-pipeline-line)]",
    "text-[color:var(--color-pipeline-ink)]",
  ].join(" "),

  // danger — red error surface (#c0392b) with white text and a matching red
  // border. Used for unreachable-contract banners on /withdraw and /deposit.
  // Implemented as a first-class variant rather than a className override to
  // avoid Tailwind v4 equal-specificity conflicts where caller-appended
  // bg-[var(--color-pipeline-danger)] classes lose to the white variant's
  // bg-[var(--color-pipeline-surface)] rule (Issue #357).
  // Text color is set here (not in baseClasses) so there is no competing
  // text-color utility at the same specificity.
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
