import React from "react";
import { Button, Card, WalletIllustration } from "@pipeline/ui";
import type { CardPadding } from "@pipeline/ui";

// spec: docs/frontend/dashboard-components.md#connectwalletpromocard
// (composition, layout, illustration positioning, Figma frame 1497:94556 node 1497:94566).

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
  /**
   * Interior padding forwarded to the `Card` primitive. Defaults to `"lg"`
   * (24px). Set to `"md"` (16px) on mobile per Figma frame `1989:8292`.
   */
  padding?: CardPadding;
}

// Stable heading id so consumers do not collide if multiple cards mount in a
// preview / story (rare, but cheap to guarantee).
/** Base heading id prefix — each instance gets a unique suffix from useId(). */
const HEADING_ID_BASE = "connect-wallet-promo-card-title";

export const ConnectWalletPromoCard = React.forwardRef<
  HTMLDivElement,
  ConnectWalletPromoCardProps
>(function ConnectWalletPromoCard({ onConnect, className, ...rest }, ref) {
  // Use a unique id per instance to avoid duplicate id attributes when both
  // the mobile and desktop blocks render this card in the same DOM.
  const instanceId = React.useId();
  const HEADING_ID = `${HEADING_ID_BASE}-${instanceId}`;
  const composed = [
    // Positioning context for the absolutely-positioned illustration.
    "relative",
    // Heading top, CTA bottom — mirrors the Figma "Top Container / Button"
    // stack with `justify-between`.
    "flex flex-col justify-between",
    "min-h-[274px] w-full",
    // Clip the illustration to the rounded card silhouette.
    "overflow-hidden",
    "!border-t !border-r-[3px] !border-b-[3px] !border-l",
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
      {/* Illustration positioning — desktop + mobile Figma anchor math:
          spec: docs/frontend/dashboard-components.md#connectwalletpromocard. */}
      <span
        className={[
          "pointer-events-none absolute -translate-y-1/2",
          // -translate-y-1/2 positions by centre, so top-[192px] supplies the
          // centre value directly rather than the top-edge value.
          "top-[192px] right-[-48px] w-[235px]",
          "md:top-[70%] md:w-[314px]",
        ].join(" ")}
      >
        <WalletIllustration
          tone="primary"
          width="100%"
          data-node-id="I1497:94566;1360:49452"
        />
      </span>

      {/* Heading block — top of the card. `relative` keeps the text above the
          absolutely-positioned illustration in the stacking order. */}
      <header
        className="relative flex flex-col gap-1"
        data-node-id="I1497:94566;1360:49019"
        data-testid="home-connect-header"
      >
        <h2
          id={HEADING_ID}
          className={[
            "font-[family-name:var(--font-display)]",
            "text-[length:var(--text-pipeline-heading-m-mobile)]",
            "leading-[var(--text-pipeline-heading-m-mobile--line-height)]",
            "md:text-[length:var(--text-pipeline-heading-m)]",
            "md:leading-[var(--text-pipeline-heading-m--line-height)]",
            "font-[var(--font-weight-regular)]",
            "text-[color:var(--color-pipeline-ink)]",
            "m-0",
          ].join(" ")}
          data-node-id="I1497:94566;1360:49019;6539:2329"
          data-testid="home-connect-heading"
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
        size="m"
        onClick={onConnect}
        className="relative self-start"
        data-node-id="I1497:94566;1360:49021"
        data-testid="home-connect-cta"
      >
        Connect
      </Button>
    </Card>
  );
});

ConnectWalletPromoCard.displayName = "ConnectWalletPromoCard";

export default ConnectWalletPromoCard;
