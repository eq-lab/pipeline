import React from "react";
import { Button, Card, CoinIcon } from "@pipeline/ui";

/**
 * StartHereCard — Disconnected-state "Get PLUSD" entry card.
 *
 * White card that sits under the Connect Wallet promo on the Disconnected
 * dashboard (Figma frame `1497:94556`, node `1497:94676` "card-horizontal"
 * inside the "Balances" stack `1497:94675`). It is the primary on-ramp for a
 * brand-new visitor: an eyebrow label, the "Get PLUSD" headline with a small
 * dollar glyph, a subtitle that explains the 1:1 USDC swap, and a row of two
 * action buttons — "Buy" (deposit entry point) and "Sell" (withdraw entry point).
 *
 *   ┌────────────────────────────────────┐
 *   │  Start here                        │
 *   │  ($) Get PLUSD                     │
 *   │  Convert USDC 1:1                  │
 *   │                                    │
 *   │  [ Buy ]  [ Sell ]                 │
 *   └────────────────────────────────────┘
 *
 * Composition (all primitives from `@pipeline/ui`):
 *   - {@link Card} `variant="white"` supplies the paper-white surface, the
 *     hairline border and the 4px corner radius. The Card already paints the
 *     token-driven chrome (`--color-pipeline-surface`, `--color-pipeline-line`)
 *     so this composer adds no raw colors.
 *   - {@link Button} `variant="primary-blue"` provides the brand-navy "Buy" CTA
 *     (Figma node `1497:94688` / `1497:94689`).
 *   - {@link Button} `variant="secondary"` provides the ghost "Sell" CTA
 *     (Figma node `1497:94690`) — ink-primary label, transparent fill.
 *     Sell navigates to `/deposit?direction=withdraw`, matching the Buy CTA
 *     symmetry: Buy → deposit, Sell → withdraw.
 *   - The PLUSD coin icon is rendered via {@link CoinIcon} `token="plusd"`
 *     `size="md"` (24 px), matching Figma node `910:10281` — the full blue
 *     circle with a white "$" glyph baked into the raster asset.
 *
 * Layout:
 *   - The Card is the positioning context for a vertical flex column with
 *     `justify-between`: the heading block hugs the top of the card and the
 *     CTA row hugs the bottom — matching the Figma "List" stack which space-
 *     between's the title block and the buttons row.
 *   - The eyebrow / heading / subtitle are a tight vertical stack: 4px gap
 *     between heading and subtitle (mirrors Figma `gap-4` on `TextCont`),
 *     no gap between the eyebrow and the heading (mirrors Figma `gap-xs=0`
 *     on `PLUSD Balance`).
 *   - The two action buttons sit side-by-side with `gap-xs` = 8px between them
 *     (mirrors Figma `gap-2` on the "Buttons" row).
 *
 * Typography (no raw font sizes — every value resolves through theme tokens):
 *   - Eyebrow "Start here": Body token (16/22) in Graphik LC, ink colour.
 *     Acts as the top-line label per the Issue spec.
 *   - Heading "Get PLUSD": Heading-S token (20/28) in Besley display serif,
 *     ink colour. The dollar glyph sits inline at 24px to the left.
 *   - Subtitle: Caption token (12/16) in Graphik LC, ink-muted colour.
 *
 * Accessibility:
 *   - The Card renders a `<div>`; we promote it to a labelled region via
 *     `role="region"` + `aria-labelledby` referencing the heading id so
 *     assistive tech announces "Get PLUSD, region".
 *   - The PLUSD coin icon is decorative; `CoinIcon` is passed `aria-hidden="true"`
 *     so it stays out of the accessibility tree.
 *   - Both CTAs are real `<button>` elements from the Button primitive with
 *     their own focus-visible styling. The disabled "Sell" button retains its
 *     semantic role in the accessibility tree so screen readers announce it.
 *
 * Reuse: this composite belongs to the Disconnected home view, paired with
 * the Connect Wallet promo card and the Earned / Staked cards. It is not
 * intended to be hoisted into `@pipeline/ui` — it lives next to the other
 * page-level components in `packages/frontend/src/components/`.
 */

export interface StartHereCardProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "children" | "title"
> {
  /**
   * Click handler for the Buy CTA. Optional so the card can be dropped
   * into preview routes without wiring the buy flow; the page-level
   * container is expected to supply this in production.
   */
  onBuy?: () => void;
  /**
   * Click handler for the Sell CTA. Optional so the card can be dropped
   * into preview routes without wiring the withdraw flow; the page-level
   * container is expected to supply this in production (wired to
   * `/deposit?direction=withdraw`).
   */
  onSell?: () => void;
}

// Stable heading id so consumers do not collide if multiple cards mount in a
// preview / story (rare, but cheap to guarantee).
const HEADING_ID = "start-here-card-title";

export const StartHereCard = React.forwardRef<
  HTMLDivElement,
  StartHereCardProps
>(function StartHereCard({ onBuy, onSell, className, ...rest }, ref) {
  const composed = [
    // Eyebrow + heading + subtitle top, CTA bottom — mirrors the Figma "List"
    // stack with `justify-between`.
    "flex flex-col justify-between gap-6",
    "w-full",
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
      data-node-id="1497:94676"
      {...rest}
    >
      {/* Heading block — eyebrow label, headline row (glyph + title), and
          muted subtitle. Stays grouped at the top of the card. */}
      <header className="flex flex-col gap-1" data-node-id="1497:94678">
        {/* Eyebrow "Start here" — Body token in Graphik LC, ink colour. */}
        <p
          className={[
            "font-[family-name:var(--font-body)]",
            "text-[length:var(--text-pipeline-body)]",
            "leading-[var(--text-pipeline-body--line-height)]",
            "font-[var(--font-weight-regular)]",
            "text-[color:var(--color-pipeline-ink)]",
            "m-0",
          ].join(" ")}
          data-node-id="1497:94679"
        >
          Start here
        </p>

        {/* Headline row — small dollar glyph + "Get PLUSD" serif heading. */}
        <div className="flex items-center gap-1" data-node-id="1497:94683">
          {/* PLUSD coin icon — decorative, 24 px, matches Figma node 910:10281. */}
          <CoinIcon
            token="plusd"
            size="md"
            aria-hidden="true"
            data-node-id="I1497:94683;910:10281"
          />
          <h2
            id={HEADING_ID}
            className={[
              "font-[family-name:var(--font-display)]",
              "text-[length:var(--text-pipeline-heading-s)]",
              "leading-[var(--text-pipeline-heading-s--line-height)]",
              "font-[var(--font-weight-regular)]",
              "text-[color:var(--color-pipeline-ink)]",
              "m-0",
            ].join(" ")}
            data-node-id="1497:94685"
          >
            Get PLUSD
          </h2>
        </div>

        {/* Subtitle — Caption token in Graphik LC, ink-muted. */}
        <p
          className={[
            "font-[family-name:var(--font-body)]",
            "text-[length:var(--text-pipeline-caption)]",
            "leading-[var(--text-pipeline-caption--line-height)]",
            "font-[var(--font-weight-regular)]",
            "text-[color:var(--color-pipeline-ink-muted)]",
            "m-0",
          ].join(" ")}
          data-node-id="1497:94687"
        >
          Convert USDC 1:1
        </p>
      </header>

      {/* Action buttons row — Buy (primary) + Sell (ghost, wired to withdraw).
          `gap-2` = 8px mirrors Figma `gap-xs` on the buttons container.
          `self-start` keeps the row flush-left at its intrinsic width. */}
      <div
        className="flex items-center gap-2 self-start"
        data-node-id="1497:94688"
      >
        <Button
          variant="primary-blue"
          onClick={onBuy}
          data-node-id="1497:94689"
        >
          Buy
        </Button>
        <Button
          variant="secondary"
          onClick={onSell}
          data-node-id="1497:94690"
        >
          Sell
        </Button>
      </div>
    </Card>
  );
});

StartHereCard.displayName = "StartHereCard";

export default StartHereCard;
