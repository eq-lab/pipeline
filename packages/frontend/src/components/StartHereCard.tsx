// spec: docs/frontend/dashboard-components.md#startherecard
import React from "react";
import { Button, Card, CoinIcon } from "@pipeline/ui";
import type { CardPadding } from "@pipeline/ui";

type MobileHomeState = "empty" | "plusd" | "splusd";

export type StartHereCardLayout = "default" | "compact";

export interface StartHereCardProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "children" | "title"
> {
  onBuy?: () => void;
  onSell?: () => void;
  sellDisabled?: boolean;
  mobileHomeState?: MobileHomeState;
  mobilePlusdBalance?: string;
  padding?: CardPadding;
  layout?: StartHereCardLayout;
}

const HEADING_ID_BASE = "start-here-card-title";

const eyebrowClasses = [
  "font-[family-name:var(--font-body)]",
  "text-[length:var(--text-pipeline-body)]",
  "leading-[var(--text-pipeline-body--line-height)]",
  "font-[var(--font-weight-regular)]",
  "text-[color:var(--color-pipeline-ink)]",
  "m-0",
].join(" ");

const responsiveHeadingClasses = [
  "font-[family-name:var(--font-display)]",
  "text-[length:var(--text-pipeline-heading-s-mobile)]",
  "leading-[var(--text-pipeline-heading-s-mobile--line-height)]",
  "md:text-[length:var(--text-pipeline-heading-s)]",
  "md:leading-[var(--text-pipeline-heading-s--line-height)]",
  "font-[var(--font-weight-regular)]",
  "text-[color:var(--color-pipeline-ink)]",
  "m-0",
].join(" ");

const compactHeadingClasses = [
  "font-[family-name:var(--font-display)]",
  "text-[length:var(--text-pipeline-heading-s)]",
  "leading-[var(--text-pipeline-heading-s--line-height)]",
  "font-[var(--font-weight-regular)]",
  "text-[color:var(--color-pipeline-ink)]",
  "m-0",
].join(" ");

const subtitleClasses = [
  "font-[family-name:var(--font-body)]",
  "text-[length:var(--text-pipeline-caption)]",
  "leading-[var(--text-pipeline-caption--line-height)]",
  "font-[var(--font-weight-regular)]",
  "text-[color:var(--color-pipeline-ink-muted)]",
  "m-0",
].join(" ");

const ELEVATION_BORDER = "!border-t !border-r-[3px] !border-b-[3px] !border-l";

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
    padding,
    layout = "default",
    ...rest
  },
  ref,
) {
  const instanceId = React.useId();
  const HEADING_ID = `${HEADING_ID_BASE}-${instanceId}`;

  const isConnectedVariant =
    mobileHomeState === "plusd" || mobileHomeState === "splusd";

  if (layout === "compact") {
    const compactComposed = [
      "flex h-[164px] w-full flex-col",
      ELEVATION_BORDER,
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <Card
        ref={ref}
        variant="white"
        padding={padding ?? "md"}
        role="region"
        aria-labelledby={HEADING_ID}
        className={compactComposed}
        data-node-id="6701:97660"
        {...rest}
      >
        <div
          className="flex h-full w-full flex-col justify-between"
          data-node-id="6701:97661"
        >
          <header
            className="flex flex-col"
            data-node-id="6701:97662"
            data-testid="home-start-here-header"
          >
            <p className={eyebrowClasses} data-node-id="6701:97663">
              Start here
            </p>
            <div className="flex flex-col gap-1" data-node-id="6701:97666">
              <div
                className="flex items-center gap-1"
                data-node-id="6701:97667"
              >
                <CoinIcon
                  token="plusd"
                  size="md"
                  aria-hidden="true"
                  data-node-id="6701:97668"
                />
                <h2
                  id={HEADING_ID}
                  className={compactHeadingClasses}
                  data-node-id="6701:97669"
                  data-testid="home-start-here-heading"
                >
                  Get PLUSD
                </h2>
              </div>
              <p className={subtitleClasses} data-node-id="6701:97671">
                Convert with USDC 1:1
              </p>
            </div>
          </header>

          <div
            className="flex items-center gap-2"
            data-node-id="6701:97675"
            data-testid="home-start-here-buttons"
          >
            <Button
              variant="primary-blue"
              size="m"
              onClick={onBuy}
              data-node-id="6701:97676"
              data-testid="home-buy-button"
            >
              Buy
            </Button>
            <Button
              variant="secondary"
              size="m"
              onClick={onSell}
              disabled={Boolean(sellDisabled)}
              data-node-id="6701:97677"
              data-testid="home-sell-button"
            >
              Sell
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  const composed = [
    "flex flex-col justify-between gap-6",
    "w-full",
    ELEVATION_BORDER,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Card
      ref={ref}
      variant="white"
      padding={padding}
      role="region"
      aria-labelledby={HEADING_ID}
      className={composed}
      data-node-id="1497:94676"
      {...rest}
    >
      {isConnectedVariant ? (
        <header
          className="flex flex-col gap-1"
          data-node-id="1497:94678"
          data-testid="home-start-here-header"
        >
          <p className={eyebrowClasses}>PLUSD Balance</p>

          <div className="flex items-center gap-1">
            <CoinIcon
              token="plusd"
              size="md"
              aria-hidden="true"
              data-node-id="I1497:94683;910:10281"
            />
            <h2 id={HEADING_ID} className={responsiveHeadingClasses}>
              {mobilePlusdBalance ?? "$0.00"}
            </h2>
          </div>

          <p
            className={subtitleClasses}
            data-node-id="1984:6772"
            data-testid="plusd-in-usdc"
          >
            {mobilePlusdBalance ?? "$0.00"} USDC
          </p>
        </header>
      ) : (
        <header
          className="flex flex-col gap-1"
          data-node-id="1497:94678"
          data-testid="home-start-here-header"
        >
          <p className={eyebrowClasses} data-node-id="1497:94679">
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
              className={responsiveHeadingClasses}
              data-node-id="1497:94685"
              data-testid="home-start-here-heading"
            >
              Get PLUSD
            </h2>
          </div>

          <p className={subtitleClasses} data-node-id="1497:94687">
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
