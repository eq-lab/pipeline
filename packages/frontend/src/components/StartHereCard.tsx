import React from "react";
import { Button, Card } from "@pipeline/ui";
import dollarGlyphUrl from "@pipeline/ui/assets/icons/nav-dollar.svg";

/**
 * StartHereCard — Disconnected-state "Get PLUSD" entry card.
 *
 * White card that sits under the Connect Wallet promo on the Disconnected
 * dashboard (Figma frame `1497:94556`, node `1497:94676` "card-horizontal"
 * inside the "Balances" stack `1497:94675`). It is the primary on-ramp for a
 * brand-new visitor: an eyebrow label, the "Get PLUSD" headline with a small
 * dollar glyph, a subtitle that explains the 1:1 USDC swap, and a navy
 * "Convert" CTA.
 *
 *   ┌────────────────────────────────────┐
 *   │  Start here                        │
 *   │  ($) Get PLUSD                     │
 *   │  Convert with USDC 1:1             │
 *   │                                    │
 *   │  [ Convert ]                       │
 *   └────────────────────────────────────┘
 *
 * Composition (all primitives from `@pipeline/ui`):
 *   - {@link Card} `variant="white"` supplies the paper-white surface, the
 *     hairline border and the 4px corner radius. The Card already paints the
 *     token-driven chrome (`--color-pipeline-surface`, `--color-pipeline-line`)
 *     so this composer adds no raw colors.
 *   - {@link Button} `variant="primary-blue"` provides the brand-navy CTA.
 *     The Button primitive owns its own 48px height, label typography and
 *     focus-visible ring; the composer only positions it at the bottom-left.
 *   - The PLUSD glyph is the existing `nav-dollar.svg` asset rendered through
 *     a CSS `mask-image` so `currentColor` tints it with the brand-navy token.
 *     This mirrors the WalletIllustration pattern (mask + currentColor) and
 *     avoids inlining a second copy of the SVG path data.
 *
 * Layout:
 *   - The Card is the positioning context for a vertical flex column with
 *     `justify-between`: the heading block hugs the top of the card and the
 *     CTA hugs the bottom — matching the Figma "List" stack which space-
 *     between's the title block and the buttons row.
 *   - The eyebrow / heading / subtitle are a tight vertical stack: 4px gap
 *     between heading and subtitle (mirrors Figma `gap-4` on `TextCont`),
 *     no gap between the eyebrow and the heading (mirrors Figma `gap-xs=0`
 *     on `PLUSD Balance`).
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
 *   - The dollar glyph is decorative; it is rendered through a CSS mask on a
 *     `<span aria-hidden="true">` so it stays out of the accessibility tree.
 *   - The CTA is a real `<button>` from the Button primitive with its own
 *     focus-visible styling.
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
   * Click handler for the Convert CTA. Optional so the card can be dropped
   * into preview routes without wiring the convert flow; the page-level
   * container is expected to supply this in production.
   */
  onConvert?: () => void;
}

// Stable heading id so consumers do not collide if multiple cards mount in a
// preview / story (rare, but cheap to guarantee).
const HEADING_ID = "start-here-card-title";

// PLUSD glyph — the existing `nav-dollar.svg` asset rendered through a CSS
// mask so `currentColor` tints the silhouette with the brand-navy token. This
// avoids inlining the SVG path data a second time and keeps the icon library
// the single source of truth for the dollar mark.
const glyphStyle: React.CSSProperties = {
  width: "24px",
  height: "24px",
  display: "inline-block",
  flexShrink: 0,
  color: "var(--color-pipeline-brand)",
  backgroundColor: "currentColor",
  WebkitMaskImage: `url(${dollarGlyphUrl})`,
  maskImage: `url(${dollarGlyphUrl})`,
  WebkitMaskRepeat: "no-repeat",
  maskRepeat: "no-repeat",
  WebkitMaskPosition: "center",
  maskPosition: "center",
  WebkitMaskSize: "contain",
  maskSize: "contain",
};

export const StartHereCard = React.forwardRef<
  HTMLDivElement,
  StartHereCardProps
>(function StartHereCard({ onConvert, className, ...rest }, ref) {
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
          {/* Decorative glyph — masked SVG so currentColor paints the
              brand-navy fill via `--color-pipeline-brand`. */}
          <span
            aria-hidden="true"
            style={glyphStyle}
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
          Convert with USDC 1:1
        </p>
      </header>

      {/* Convert CTA — bottom of the card. `self-start` keeps the button
          flush-left and at its intrinsic width (the Figma button hugs its
          label, not stretched). */}
      <Button
        variant="primary-blue"
        onClick={onConvert}
        className="self-start"
        data-node-id="1497:94689"
      >
        Convert
      </Button>
    </Card>
  );
});

StartHereCard.displayName = "StartHereCard";

export default StartHereCard;
