import React from "react";
import { CoinIcon } from "../CoinIcon/CoinIcon";

/**
 * TokenAmountDisplay — read-only counterpart to `TokenInput`.
 * spec: docs/frontend/ui-components.md#tokenamountdisplay
 */

export interface TokenAmountDisplayProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Which coin token to display. */
  token: "usdc" | "plusd" | "splusd";
  /** Token label shown next to the coin, e.g. "PLUSD". */
  tokenLabel: string;
  /** Pre-formatted balance string, e.g. "0.00". */
  balanceLabel: string;
  /** Pre-formatted numeric value to display, e.g. "0". */
  value: string;
}

const cardClasses = [
  "bg-[var(--color-pipeline-surface)]",
  "border border-[var(--color-pipeline-line)]",
  "rounded-[var(--radius-pipeline-card)]",
  "flex flex-col",
  "w-full",
  "pt-4 pb-8",
].join(" ");

const identityClasses = ["flex flex-1 items-center", "gap-3", "min-w-0"].join(
  " ",
);

const tokenLabelClasses = [
  "font-[family-name:var(--font-body)]",
  "text-[length:var(--text-pipeline-body)]",
  "leading-[var(--text-pipeline-body--line-height)]",
  "font-[var(--font-weight-regular)]",
  "text-[color:var(--color-pipeline-ink)]",
  "overflow-hidden text-ellipsis whitespace-nowrap",
].join(" ");

const balanceLabelClasses = [
  "font-[family-name:var(--font-body)]",
  "text-[length:var(--text-pipeline-caption)]",
  "leading-[var(--text-pipeline-caption--line-height)]",
  "font-[var(--font-weight-regular)]",
  "text-[color:var(--color-pipeline-ink-muted)]",
  "overflow-hidden text-ellipsis whitespace-nowrap",
].join(" ");

const valueClasses = [
  "font-[family-name:var(--font-display)]",
  "text-[24px] leading-[28px]",
  "font-normal",
  "text-[color:var(--color-pipeline-ink-subtle)]",
  "text-right",
  "select-all",
].join(" ");

export const TokenAmountDisplay = React.forwardRef<
  HTMLDivElement,
  TokenAmountDisplayProps
>(function TokenAmountDisplay(
  { token, tokenLabel, balanceLabel, value, className, ...rest },
  ref,
) {
  const composed = [cardClasses, className].filter(Boolean).join(" ");

  return (
    <div
      ref={ref}
      data-testid="token-amount-display"
      className={composed}
      {...rest}
    >
      <div
        data-testid="token-amount-display-row"
        className="flex items-center justify-between pr-2"
      >
        <div className={identityClasses}>
          <CoinIcon token={token} size="lg" aria-hidden />
          <div className="flex min-w-0 flex-col items-start justify-center">
            <span className={tokenLabelClasses}>{tokenLabel}</span>
            <span className={balanceLabelClasses}>{balanceLabel}</span>
          </div>
        </div>

        <div
          className="flex shrink-0 items-start justify-end"
          aria-label={`${tokenLabel} amount: ${value}`}
        >
          <span className={valueClasses} aria-hidden="true">
            {value}
          </span>
        </div>
      </div>
    </div>
  );
});

TokenAmountDisplay.displayName = "TokenAmountDisplay";

export default TokenAmountDisplay;
