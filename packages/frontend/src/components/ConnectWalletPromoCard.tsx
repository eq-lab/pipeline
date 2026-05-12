import React from "react";
import { Button, Card, WalletIllustration } from "@pipeline/ui";

/**
 * ConnectWalletPromoCard — Disconnected-state hero card.
 *
 * Pale-yellow promo card that sits across the top of the left column on the
 * Disconnected dashboard (Figma frame `1497:94556`, node `1497:94566`
 * "Portfolio"). It invites the wallet-less visitor to connect:
 *
 *   ┌────────────────────────────────────────────────────────────┐
 *   │  Connect Wallet                                            │
 *   │  Access real-world yield on-chain          ╱╱╱╱            │
 *   │                                        ╱╱╱╱╱╱╱╱            │
 *   │                                        ╱╱╱╱╱╱ ◯            │
 *   │  [ Connect ]                           ╱╱╱╱╱╱              │
 *   └────────────────────────────────────────────────────────────┘
 *
 * Composition (all primitives from `@pipeline/ui`):
 *   - {@link Card} `variant="yellow"` supplies the pale-yellow promo surface,
 *     hairline border, 4px radius and 24px interior padding. The Card already
 *     paints the tokens (`--color-pipeline-promo`, `--color-pipeline-line`)
 *     so this composer adds no raw colors.
 *   - {@link WalletIllustration} `tone="primary"` paints the striped-wallet
 *     decoration in brand navy. It is placed absolutely so the heading +
 *     button column can flow naturally along the left edge while the artwork
 *     anchors to the right. The Figma node positions the 313.672 × 200 vector
 *     at `left: 376.09px / top: 91.38px` inside a 274px-tall card; we mirror
 *     that with a `right`-based offset so the composition reads identically
 *     while remaining width-agnostic.
 *   - {@link Button} `variant="primary-dark"` provides the 48px-tall black
 *     "Connect" CTA at the bottom-left.
 *
 * Layout:
 *   - The Card is the positioning context (`relative`). Inner content is a
 *     vertical flex column with `justify-between` so the heading hugs the
 *     top of the card and the CTA hugs the bottom — matching the Figma
 *     "Top Container / Button" stack.
 *   - `overflow-hidden` clips the illustration to the rounded card edge if
 *     the container narrows past the artwork's footprint.
 *   - `min-h-[274px]` mirrors the Figma height; the card can grow with
 *     content but never collapses below the designed silhouette.
 *
 * Typography:
 *   - Title uses the Heading M token (`--text-pipeline-heading-m` = 28px,
 *     line-height 36px) in the Besley display family.
 *   - Subtitle uses the Body token (16/22) in Graphik LC, muted ink.
 *   No raw font sizes or colors are introduced.
 *
 * Accessibility:
 *   - The Card renders a `<div>`; we promote it to a landmark via
 *     `role="region"` + `aria-labelledby` referencing the heading id so
 *     assistive tech announces "Connect Wallet, region".
 *   - The illustration is decorative; `WalletIllustration` sets
 *     `aria-hidden="true"` internally.
 *   - The CTA is a real `<button>` (provided by the `Button` primitive) with
 *     focus-visible styling inherited from the primitive.
 *
 * Reuse: this composite belongs to the Disconnected home view. Once a wallet
 * is connected the card is replaced by the portfolio summary, so it is not
 * intended to be hoisted into `@pipeline/ui` — it lives next to the rest of
 * the page-level components in `packages/frontend/src/components/`.
 */

export interface ConnectWalletPromoCardProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "children" | "title"
> {
  /**
   * Click handler for the Connect CTA. Optional so the card can be dropped
   * into Storybook / preview routes without wiring a wallet provider; the
   * page-level container is expected to supply this in production.
   */
  onConnect?: () => void;
}

// Stable heading id so consumers do not collide if multiple cards mount in a
// preview / story (rare, but cheap to guarantee).
const HEADING_ID = "connect-wallet-promo-card-title";

export const ConnectWalletPromoCard = React.forwardRef<
  HTMLDivElement,
  ConnectWalletPromoCardProps
>(function ConnectWalletPromoCard({ onConnect, className, ...rest }, ref) {
  const composed = [
    // Positioning context for the absolutely-positioned illustration.
    "relative",
    // Heading top, CTA bottom — mirrors the Figma "Top Container / Button"
    // stack with `justify-between`.
    "flex flex-col justify-between",
    "min-h-[274px] w-full",
    // Clip the illustration to the rounded card silhouette.
    "overflow-hidden",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Card
      ref={ref}
      variant="yellow"
      role="region"
      aria-labelledby={HEADING_ID}
      className={composed}
      data-node-id="1497:94566"
      {...rest}
    >
      {/* Decorative illustration — absolutely positioned so it does not
          participate in the flex layout. Anchored to the right edge with a
          24px inset so it sits cleanly inside the Card's 24px interior
          padding, and vertically centred so it reads as the Figma anchor
          point at top: 91.38px inside a 274px card (= roughly centre). */}
      <WalletIllustration
        tone="primary"
        width={314}
        className="pointer-events-none absolute top-1/2 right-6 -translate-y-1/2"
        data-node-id="I1497:94566;1360:49452"
      />

      {/* Heading block — top of the card. `relative` keeps the text above the
          absolutely-positioned illustration in the stacking order. */}
      <header
        className="relative flex flex-col gap-1"
        data-node-id="I1497:94566;1360:49019"
      >
        <h2
          id={HEADING_ID}
          className={[
            "font-[family-name:var(--font-display)]",
            "text-[length:var(--text-pipeline-heading-m)]",
            "leading-[var(--text-pipeline-heading-m--line-height)]",
            "font-[var(--font-weight-regular)]",
            "text-[color:var(--color-pipeline-ink)]",
            "m-0",
          ].join(" ")}
          data-node-id="I1497:94566;1360:49019;6539:2329"
        >
          Connect Wallet
        </h2>
        <p
          className={[
            "font-[family-name:var(--font-body)]",
            "text-[length:var(--text-pipeline-body)]",
            "leading-[var(--text-pipeline-body--line-height)]",
            "font-[var(--font-weight-regular)]",
            "text-[color:var(--color-pipeline-ink-muted)]",
            "m-0",
          ].join(" ")}
          data-node-id="I1497:94566;1360:49019;6539:2331"
        >
          Access real-world yield on-chain
        </p>
      </header>

      {/* Connect CTA — bottom of the card. `self-start` keeps the button
          flush-left and at its intrinsic width (the Figma button hugs its
          label, not stretched). `relative` keeps it above the artwork. */}
      <Button
        variant="primary-dark"
        onClick={onConnect}
        className="relative self-start"
        data-node-id="I1497:94566;1360:49021"
      >
        Connect
      </Button>
    </Card>
  );
});

ConnectWalletPromoCard.displayName = "ConnectWalletPromoCard";

export default ConnectWalletPromoCard;
