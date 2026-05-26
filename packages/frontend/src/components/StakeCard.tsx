import React from "react";
import { Button, Card } from "@pipeline/ui";

/**
 * StakeCard — Stake PLUSD entry-point card.
 *
 * Small white card in the lower-middle slot of the Disconnected dashboard
 * (Figma frame `1497:94556`, node `1497:94702` "card-horizontal"). It
 * advertises the staking yield and offers the circular "Stake" CTA:
 *
 *   ┌───────────────────────────────────────┐
 *   │  Stake PLUSD                          │
 *   │  Earn 8.42%                           │
 *   │  From loan coupons and T-bills        │
 *   │                                       │
 *   │                              ╭─────╮  │
 *   │                              │Stake│  │
 *   │                              ╰─────╯  │
 *   └───────────────────────────────────────┘
 *
 * Composition (all primitives from `@pipeline/ui`):
 *   - {@link Card} `variant="white"` supplies the paper-white surface with the
 *     hairline border, 4px radius and 16px interior padding mirroring the
 *     Figma "card-horizontal" frame.
 *   - {@link Button} `variant="circular-blue"` provides the 128px round navy
 *     "Stake" CTA anchored bottom-right (Figma node `1497:94713`).
 *
 * Layout:
 *   - The Card hosts a vertical flex column with `justify-between` so the
 *     text block hugs the top of the card and the circular CTA hugs the
 *     bottom-right — matching the Figma stack with `items-end`.
 *   - `min-h-[274px]` mirrors the Figma height; the card may grow with
 *     content but does not collapse below the designed silhouette.
 *   - `overflow-hidden` clips the round CTA to the rounded card edge if a
 *     narrow container ever pushes the circle outside the surface.
 *
 * Typography:
 *   - The top-line label ("Stake PLUSD") uses the Body token (16/22) in
 *     Graphik LC at primary ink — same treatment as the "Start here" /
 *     "Earned" labels on the sibling cards.
 *   - The main line ("Earn 8.42%") uses the Heading 20 token (20/28) in the
 *     Besley display family at primary ink, matching "Get PLUSD" / "Coming
 *     soon" headings on the sibling cards.
 *   - The subtitle ("From loan coupons and T-bills") uses the Caption token
 *     (12/16) in Graphik LC at muted ink, matching "Convert with USDC 1:1".
 *   No raw font sizes or colors are introduced — every value resolves to a
 *   token in `@pipeline/ui/styles/theme.css`.
 *
 * Content:
 *   - The 8.42% APY figure is intentionally hardcoded in this issue (per the
 *     Issue body); a future task will wire it to live protocol state.
 *
 * Accessibility:
 *   - The Card is promoted to a labelled region via `role="region"` +
 *     `aria-labelledby` referencing the "Stake PLUSD" heading id so
 *     assistive tech announces "Stake PLUSD, region".
 *   - The circular CTA is a real `<button>` (provided by the `Button`
 *     primitive) and inherits focus-visible styling from the primitive.
 *     An `aria-label="Stake PLUSD"` makes the button's intent unambiguous
 *     when read in isolation (the visible label is just "Stake").
 *
 * Reuse: this composite belongs to the dashboard view. It is page-level
 * glue around `@pipeline/ui` primitives and lives next to the rest of the
 * page composers in `packages/frontend/src/components/`.
 */

export interface StakeCardProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "children" | "title"
> {
  /**
   * Click handler for the Stake CTA. Optional so the card can be dropped
   * into Storybook / preview routes without wiring a staking flow; the
   * page-level container is expected to supply this in production.
   */
  onStake?: () => void;
  /**
   * When `true`, the Stake CTA is rendered in its disabled state (per Figma
   * node `1497:95069`). Pass `true` when the connected wallet's PLUSD balance
   * is zero so the button cannot initiate a stake flow with no tokens.
   */
  stakeDisabled?: boolean;
}

// Stable heading id so consumers do not collide if multiple cards mount in a
// preview / story (rare, but cheap to guarantee).
const HEADING_ID = "stake-card-title";

export const StakeCard = React.forwardRef<HTMLDivElement, StakeCardProps>(
  function StakeCard({ onStake, stakeDisabled, className, ...rest }, ref) {
    const composed = [
      // Text block top, circular CTA bottom-right — mirrors the Figma
      // "card-horizontal" stack with `justify-between` + `items-end`.
      "flex flex-col items-end justify-between",
      "min-h-[274px] w-full",
      // Clip the circular CTA to the rounded card silhouette.
      "overflow-hidden",
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <Card
        ref={ref}
        variant="white"
        role="region"
        aria-labelledby={HEADING_ID}
        className={composed}
        data-node-id="1497:94702"
        {...rest}
      >
        {/* Text block — top of the card, left-aligned. The Card uses
            `items-end` for the CTA, so we restore left alignment locally
            with `self-start` and a `w-full` so the heading occupies the
            full width of the card surface (mirroring the Figma "Staked
            PLUSD Balance" frame). */}
        <header
          className="flex w-full flex-col items-start gap-1 self-start"
          data-node-id="1497:94703"
        >
          {/* Top-line label — "Stake PLUSD". Body token in Graphik LC. */}
          <p
            id={HEADING_ID}
            className={[
              "font-[family-name:var(--font-body)]",
              "text-[length:var(--text-pipeline-body)]",
              "leading-[var(--text-pipeline-body--line-height)]",
              "font-[var(--font-weight-regular)]",
              "text-[color:var(--color-pipeline-ink)]",
              "m-0",
            ].join(" ")}
            data-node-id="1497:94704"
          >
            Stake PLUSD
          </p>
          {/* Main line — "Earn 8.42%". Heading 20 in Besley display. */}
          <p
            className={[
              "font-[family-name:var(--font-display)]",
              "text-[length:var(--text-pipeline-heading-s)]",
              "leading-[var(--text-pipeline-heading-s--line-height)]",
              "font-[var(--font-weight-regular)]",
              "text-[color:var(--color-pipeline-ink)]",
              "m-0",
            ].join(" ")}
            data-node-id="1497:94709"
          >
            Earn 8.42%
          </p>
          {/* Subtitle — "From loan coupons and T-bills". Caption in Graphik
              LC, muted ink. */}
          <p
            className={[
              "font-[family-name:var(--font-body)]",
              "text-[length:var(--text-pipeline-caption)]",
              "leading-[var(--text-pipeline-caption--line-height)]",
              "font-[var(--font-weight-regular)]",
              "text-[color:var(--color-pipeline-ink-muted)]",
              "m-0",
            ].join(" ")}
            data-node-id="1497:94711"
          >
            From loan coupons and T-bills
          </p>
        </header>

        {/* Stake CTA — bottom-right of the card. The parent flex column uses
            `items-end`, so the circular button naturally anchors to the
            right edge. */}
        <Button
          variant="circular-blue"
          onClick={onStake}
          disabled={stakeDisabled}
          aria-label="Stake PLUSD"
          data-node-id="1497:94713"
        >
          Stake
        </Button>
      </Card>
    );
  },
);

StakeCard.displayName = "StakeCard";

export default StakeCard;
