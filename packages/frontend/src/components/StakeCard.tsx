import React from "react";
import { formatUnits } from "viem";
import { Button, Card, CoinIcon } from "@pipeline/ui";
import type { CardPadding } from "@pipeline/ui";
import { useStats, formatApy } from "@/api";

// spec: docs/frontend/dashboard-components.md#stakecard
// (composition, states A/B/C, APY sourcing, Figma frame 1497:94556 node 1497:94702).

/** Mobile home balance state — drives the StakeCard variant. */
type MobileHomeState = "empty" | "plusd" | "splusd";

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
   * Click handler for the "Unstake" text link shown in the `"splusd"` state.
   * Expected to navigate to the stake page's Unstake tab
   * (`/stake?tab=unstake`). Falls back to {@link StakeCardProps.onStake} when
   * omitted.
   */
  onUnstake?: () => void;
  /**
   * When `true`, the Stake CTA is rendered in its disabled state (per Figma
   * node `1497:95069`). Pass `true` when the connected wallet's PLUSD balance
   * is zero so the button cannot initiate a stake flow with no tokens.
   */
  stakeDisabled?: boolean;
  /**
   * Connected balance state (empty/plusd/splusd). `undefined` preserves the
   * marketing CTA appearance. spec: docs/frontend/dashboard-components.md#stakecard (states A/B/C).
   */
  mobileHomeState?: MobileHomeState;
  /**
   * sPLUSD share balance (raw bigint at `splusdDecimals` scale). Displayed as
   * the top number ("shares") in the `"splusd"` state.
   */
  mobileSplusdShares?: bigint;
  /**
   * sPLUSD shares converted to PLUSD-equivalent (raw bigint at `splusdDecimals`
   * scale). Displayed as the sub-line ("X.XX sPLUSD") in the `"splusd"` state.
   */
  mobileSplusdInPlusd?: bigint;
  /**
   * Preformatted USD value of the staked position (e.g. `"$1,000.00"`). When
   * provided, it is appended to the `"splusd"` sub-line as `· $X.XX` (Figma
   * node `1497:95226`). Omitted from the sub-line when `undefined`.
   */
  splusdUsdValue?: string;
  /**
   * Decimal precision of `mobileSplusdShares` and `mobileSplusdInPlusd`.
   * Defaults to `18` (EVM). Pass `7` for Stellar SAC balances to avoid a
   * ~1e11× scale error when formatting. (#688)
   */
  splusdDecimals?: number;
  /**
   * Interior padding forwarded to the `Card` primitive. Defaults to `"lg"`
   * (24px). Set to `"sm"` (8px) on mobile per Figma frame `1989:8292`.
   */
  padding?: CardPadding;
}

/** Base heading id prefix — each instance gets a unique suffix from useId(). */
const HEADING_ID_BASE = "stake-card-title";

/**
 * Format a bigint to a locale number string (e.g. "1,000.00").
 *
 * @param value    - Raw bigint balance.
 * @param decimals - Decimal precision of `value`. Defaults to `18` (EVM).
 *                   Pass `7` for Stellar SAC balances (#688).
 */
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
      ...rest
    },
    ref,
  ) {
    // Use a unique id per instance to avoid duplicate id attributes when both
    // the mobile and desktop blocks render this card in the same DOM.
    const instanceId = React.useId();
    const HEADING_ID = `${HEADING_ID_BASE}-${instanceId}`;

    const { data: statsData } = useStats();
    const apyLabel = `Earn ${formatApy(statsData?.vaults[0]?.apy)} p.a.`;

    const isStakeCtaDisabled =
      Boolean(stakeDisabled) ||
      (mobileHomeState !== undefined && mobileHomeState === "empty");

    const composed = [
      "flex flex-col items-end justify-between",
      "min-h-[274px] w-full",
      "overflow-hidden",
      "!border-t !border-r-[3px] !border-b-[3px] !border-l",
      className,
    ]
      .filter(Boolean)
      .join(" ");

    // State C: "Staked PLUSD" display with shares and PLUSD-equivalent.
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
          role="region"
          aria-labelledby={HEADING_ID}
          className={composed}
          data-node-id="1497:94702"
          {...rest}
        >
          {/* Staked PLUSD header */}
          <header
            className="flex w-full flex-col items-start gap-1 self-start"
            data-node-id="1497:94703"
          >
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
            >
              Staked PLUSD
            </p>
            {/* Top number: sPLUSD shares */}
            <p
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
              data-testid="splusd-shares"
            >
              {sharesFormatted}
            </p>
            {/* spec: docs/frontend/dashboard-components.md#stakecard (sub-line, Figma nodes 1497:95225 / 1497:95226). */}
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
              <p
                className={[
                  "font-[family-name:var(--font-body)]",
                  "text-[length:var(--text-pipeline-caption)]",
                  "leading-[var(--text-pipeline-caption--line-height)]",
                  "font-[var(--font-weight-regular)]",
                  "text-[color:var(--color-pipeline-ink-muted)]",
                  "m-0",
                ].join(" ")}
              >
                {inPlusdFormatted} sPLUSD
                {splusdUsdValue ? ` · ${splusdUsdValue}` : ""}
              </p>
            </div>
          </header>

          {/* spec: docs/frontend/dashboard-components.md#stakecard (bottom section, Figma node 1497:95228). */}
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
        role="region"
        aria-labelledby={HEADING_ID}
        className={composed}
        data-node-id="1497:94702"
        {...rest}
      >
        {/* The Card uses `items-end` for the CTA, so we restore left alignment
            locally with `self-start` + `w-full` on this header block. */}
        <header
          className="flex w-full flex-col items-start gap-1 self-start"
          data-node-id="1497:94703"
          data-testid="home-stake-header"
        >
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
          <p
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
            data-node-id="1497:94709"
            data-testid="home-stake-heading"
          >
            {apyLabel}
          </p>
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
            From senior loan coupons and T-bills
          </p>
        </header>

        {/* The parent flex column uses `items-end`, so the circular button
            naturally anchors to the right edge. States: see spec. */}
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
