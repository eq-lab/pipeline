import React from "react";
import { Button, Card, CoinIcon } from "@pipeline/ui";
import type { CardPadding } from "@pipeline/ui";

// spec: docs/frontend/dashboard-components.md#startherecard
// (composition, states A/B/C, Buy/Sell wiring, Figma frame 1497:94556 node 1497:94676).

/** Mobile home balance state — drives the card's connected variant display. */
type MobileHomeState = "empty" | "plusd" | "splusd";

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
  sellDisabled?: boolean;
  /**
   * Mobile-only: connected balance state (empty/plusd/splusd).
   * spec: docs/frontend/dashboard-components.md#startherecard (states A/B/C).
   */
  mobileHomeState?: MobileHomeState;
  /**
   * Mobile-only: formatted PLUSD balance string (e.g. `"$1,000.00"`). Ignored
   * when `mobileHomeState` is `undefined` or `"empty"`.
   */
  mobilePlusdBalance?: string;
  /**
   * Interior padding forwarded to the `Card` primitive. Defaults to `"lg"`
   * (24px). Set to `"sm"` (8px) on mobile per Figma frame `1989:8292`.
   */
  padding?: CardPadding;
}

/** Base heading id prefix — each instance gets a unique suffix from useId(). */
const HEADING_ID_BASE = "start-here-card-title";

export const StartHereCard = React.forwardRef<
  HTMLDivElement,
  StartHereCardProps
>(function StartHereCard(
  {
    onBuy,
    onSell,
    sellDisabled,
    className,
    mobileHomeState,
    mobilePlusdBalance,
    ...rest
  },
  ref,
) {
  // Use a unique id per instance to avoid duplicate id attributes when both
  // the mobile and desktop blocks render this card in the same DOM.
  const instanceId = React.useId();
  const HEADING_ID = `${HEADING_ID_BASE}-${instanceId}`;

  // "Connected" variant: shown in States B and C on mobile.
  const isConnectedVariant =
    mobileHomeState === "plusd" || mobileHomeState === "splusd";

  const composed = [
    "flex flex-col justify-between gap-6",
    "w-full",
    "!border-t !border-r-[3px] !border-b-[3px] !border-l",
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
      {isConnectedVariant ? (
        /* ── Connected variant (States B & C): "PLUSD Balance" ──────────── */
        <header
          className="flex flex-col gap-1"
          data-node-id="1497:94678"
          data-testid="home-start-here-header"
        >
          <p
            className={[
              "font-[family-name:var(--font-body)]",
              "text-[length:var(--text-pipeline-body)]",
              "leading-[var(--text-pipeline-body--line-height)]",
              "font-[var(--font-weight-regular)]",
              "text-[color:var(--color-pipeline-ink)]",
              "m-0",
            ].join(" ")}
          >
            PLUSD Balance
          </p>

          <div className="flex items-center gap-1">
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
                "text-[length:var(--text-pipeline-heading-s-mobile)]",
                "leading-[var(--text-pipeline-heading-s-mobile--line-height)]",
                "md:text-[length:var(--text-pipeline-heading-s)]",
                "md:leading-[var(--text-pipeline-heading-s--line-height)]",
                "font-[var(--font-weight-regular)]",
                "text-[color:var(--color-pipeline-ink)]",
                "m-0",
              ].join(" ")}
            >
              {mobilePlusdBalance ?? "$0.00"}
            </h2>
          </div>

          {/* spec: docs/frontend/dashboard-components.md#startherecard (USDC sub-line, Figma node 1984:6772). */}
          <p
            className={[
              "font-[family-name:var(--font-body)]",
              "text-[length:var(--text-pipeline-caption)]",
              "leading-[var(--text-pipeline-caption--line-height)]",
              "font-[var(--font-weight-regular)]",
              "text-[color:var(--color-pipeline-ink-muted)]",
              "m-0",
            ].join(" ")}
            data-node-id="1984:6772"
            data-testid="plusd-in-usdc"
          >
            {mobilePlusdBalance ?? "$0.00"} USDC
          </p>
        </header>
      ) : (
        /* ── Disconnected / State A variant: "Start here / Get PLUSD" ───── */
        <header
          className="flex flex-col gap-1"
          data-node-id="1497:94678"
          data-testid="home-start-here-header"
        >
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

          <div className="flex items-center gap-1" data-node-id="1497:94683">
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
                "text-[length:var(--text-pipeline-heading-s-mobile)]",
                "leading-[var(--text-pipeline-heading-s-mobile--line-height)]",
                "md:text-[length:var(--text-pipeline-heading-s)]",
                "md:leading-[var(--text-pipeline-heading-s--line-height)]",
                "font-[var(--font-weight-regular)]",
                "text-[color:var(--color-pipeline-ink)]",
                "m-0",
              ].join(" ")}
              data-node-id="1497:94685"
              data-testid="home-start-here-heading"
            >
              Get PLUSD
            </h2>
          </div>

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
      )}

      <div
        className="flex items-center gap-2 self-start"
        data-node-id="1497:94688"
        data-testid="home-start-here-buttons"
      >
        <Button
          variant="primary-blue"
          size="m"
          onClick={onBuy}
          data-node-id="1497:94689"
          data-testid="home-buy-button"
        >
          Buy
        </Button>
        <Button
          variant="secondary"
          size="m"
          onClick={onSell}
          disabled={Boolean(sellDisabled) || mobileHomeState === "empty"}
          data-node-id="1497:94690"
          data-testid="home-sell-button"
        >
          Sell
        </Button>
      </div>
    </Card>
  );
});

StartHereCard.displayName = "StartHereCard";

export default StartHereCard;
