// spec: docs/frontend/dashboard-components.md#stakecard
import React from "react";
import { formatUnits } from "viem";
import { Button, Card, CoinIcon } from "@pipeline/ui";
import type { CardPadding } from "@pipeline/ui";
import { useStats, formatApy } from "@/api";

type MobileHomeState = "empty" | "plusd" | "splusd";

export type StakeCardLayout = "default" | "compact";

export interface StakeCardProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "children" | "title"
> {
  onStake?: () => void;
  onUnstake?: () => void;
  stakeDisabled?: boolean;
  mobileHomeState?: MobileHomeState;
  mobileSplusdShares?: bigint;
  mobileSplusdInPlusd?: bigint;
  splusdUsdValue?: string;
  splusdDecimals?: number;
  padding?: CardPadding;
  layout?: StakeCardLayout;
}

const HEADING_ID_BASE = "stake-card-title";

const ELEVATION_BORDER = "!border-t !border-r-[3px] !border-b-[3px] !border-l";

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

function formatBigintNumber(value: bigint | undefined, decimals = 18): string {
  if (value === undefined) return "0.00";
  const asFloat = parseFloat(formatUnits(value, decimals));
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(asFloat);
}

export const StakeCard = React.forwardRef<HTMLDivElement, StakeCardProps>(
  function StakeCard(
    {
      onStake,
      onUnstake,
      stakeDisabled,
      className,
      mobileHomeState,
      mobileSplusdShares,
      mobileSplusdInPlusd,
      splusdUsdValue,
      splusdDecimals = 18,
      padding,
      layout = "default",
      ...rest
    },
    ref,
  ) {
    const instanceId = React.useId();
    const HEADING_ID = `${HEADING_ID_BASE}-${instanceId}`;

    const { data: statsData } = useStats();
    const apyLabel = `Earn ${formatApy(statsData?.vaults[0]?.apy)} p.a.`;

    const isStakeCtaDisabled =
      Boolean(stakeDisabled) ||
      (mobileHomeState !== undefined && mobileHomeState === "empty");

    if (layout === "compact") {
      const compactComposed = [
        "flex h-[164px] w-full flex-col justify-between",
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
          data-node-id="6701:97678"
          {...rest}
        >
          <header
            className="flex w-full flex-col"
            data-node-id="6701:97679"
            data-testid="home-stake-header"
          >
            <p
              id={HEADING_ID}
              className={eyebrowClasses}
              data-node-id="6701:97680"
            >
              Stake PLUSD
            </p>
            <div className="flex flex-col gap-1" data-node-id="6701:97683">
              <p
                className={compactHeadingClasses}
                data-node-id="6701:97685"
                data-testid="home-stake-heading"
              >
                {apyLabel}
              </p>
              <p className={subtitleClasses} data-node-id="6701:97688">
                From senior loan coupons and T-bills
              </p>
            </div>
          </header>

          <div
            className="flex w-full items-center gap-2"
            data-node-id="6701:97692"
            data-testid="home-stake-actions"
          >
            <Button
              variant="primary-blue"
              size="m"
              onClick={onStake}
              disabled={isStakeCtaDisabled}
              data-node-id="6701:97693"
              data-testid="home-stake-button"
            >
              Stake
            </Button>
          </div>
        </Card>
      );
    }

    const composed = [
      "flex flex-col items-end justify-between",
      "min-h-[274px] w-full",
      "overflow-hidden",
      ELEVATION_BORDER,
      className,
    ]
      .filter(Boolean)
      .join(" ");

    if (mobileHomeState === "splusd") {
      const sharesFormatted = formatBigintNumber(
        mobileSplusdShares,
        splusdDecimals,
      );
      const inPlusdFormatted = formatBigintNumber(
        mobileSplusdInPlusd,
        splusdDecimals,
      );

      return (
        <Card
          ref={ref}
          variant="white"
          padding={padding}
          role="region"
          aria-labelledby={HEADING_ID}
          className={composed}
          data-node-id="1497:94702"
          {...rest}
        >
          <header
            className="flex w-full flex-col items-start gap-1 self-start"
            data-node-id="1497:94703"
          >
            <p id={HEADING_ID} className={eyebrowClasses}>
              Staked PLUSD
            </p>
            <p className={responsiveHeadingClasses} data-testid="splusd-shares">
              {sharesFormatted}
            </p>
            <div
              className="flex w-full items-center gap-1"
              data-testid="splusd-in-plusd"
            >
              <CoinIcon
                token="splusd"
                size="sm"
                className="size-4 shrink-0"
                aria-hidden
              />
              <p className={subtitleClasses}>
                {inPlusdFormatted} sPLUSD
                {splusdUsdValue ? ` · ${splusdUsdValue}` : ""}
              </p>
            </div>
          </header>

          <div
            className="flex w-full items-end justify-between"
            data-testid="home-stake-actions"
          >
            <button
              type="button"
              onClick={onUnstake ?? onStake}
              className={[
                "font-[family-name:var(--font-body)]",
                "text-[length:var(--text-pipeline-body)]",
                "leading-[var(--text-pipeline-body--line-height)]",
                "font-[var(--font-weight-emphasized)]",
                "text-[color:var(--color-pipeline-ink-muted)]",
                "underline-offset-2 hover:underline",
                "cursor-pointer border-0 bg-transparent p-0",
              ].join(" ")}
              data-testid="unstake-link"
            >
              Unstake
            </button>
            <Button
              variant="circular-blue"
              onClick={onStake}
              aria-label="Stake More PLUSD"
              className="size-[88px] md:size-32"
              data-node-id="1497:94713"
              data-testid="home-stake-more-button"
            >
              <span className="flex flex-col items-center leading-[var(--text-pipeline-body--line-height)]">
                <span>Stake</span>
                <span>More</span>
              </span>
            </Button>
          </div>
        </Card>
      );
    }

    return (
      <Card
        ref={ref}
        variant="white"
        padding={padding}
        role="region"
        aria-labelledby={HEADING_ID}
        className={composed}
        data-node-id="1497:94702"
        {...rest}
      >
        <header
          className="flex w-full flex-col items-start gap-1 self-start"
          data-node-id="1497:94703"
          data-testid="home-stake-header"
        >
          <p
            id={HEADING_ID}
            className={eyebrowClasses}
            data-node-id="1497:94704"
          >
            Stake PLUSD
          </p>
          <p
            className={responsiveHeadingClasses}
            data-node-id="1497:94709"
            data-testid="home-stake-heading"
          >
            {apyLabel}
          </p>
          <p className={subtitleClasses} data-node-id="1497:94711">
            From senior loan coupons and T-bills
          </p>
        </header>

        <Button
          variant="circular-blue"
          onClick={onStake}
          disabled={isStakeCtaDisabled}
          aria-label={isStakeCtaDisabled ? "Nothing to Stake" : "Stake PLUSD"}
          className="size-[88px] md:size-32"
          data-node-id="1497:94713"
          data-testid="home-stake-button"
        >
          {isStakeCtaDisabled ? "Nothing to Stake" : "Stake"}
        </Button>
      </Card>
    );
  },
);

StakeCard.displayName = "StakeCard";

export default StakeCard;
