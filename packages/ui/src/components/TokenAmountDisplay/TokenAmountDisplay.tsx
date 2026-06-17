import React from "react";
import { CoinIcon } from "../CoinIcon/CoinIcon";

/**
 * TokenAmountDisplay — read-only counterpart to `TokenInput`.
 *
 * Renders the same top-half layout as `TokenInput`:
 *   - Token coin icon (CoinIcon at lg/40 px) + token label + balance subtitle
 *   - A large display-serif numeric value (right-aligned, display only)
 *
 * No interactive elements, no `<input>`.  Intended for the PLUS-D (output)
 * side of the conversion card where the value is computed, not entered.
 *
 * Design tokens used:
 *   - `--color-pipeline-surface`     — white card fill
 *   - `--color-pipeline-line`        — card border
 *   - `--color-pipeline-ink`         — primary text
 *   - `--color-pipeline-ink-muted`   — balance subtitle
 *   - `--color-pipeline-ink-subtle`  — numeric value colour (matches TokenInput placeholder)
 *   - `--radius-pipeline-card`       — card corner radius
 *   - `--font-display`, `--font-body` — typeface families
 *   - `--text-pipeline-*` size/lh pairs
 *   - `--font-weight-regular`
 *
 * Figma reference: node 1498-100130 (PLUSD side of the conversion card).
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

// Outer card — white fill, subtle border, card radius.
// Matches TokenInput card layout: same padding so they stack cleanly.
const cardClasses = [
  "bg-[var(--color-pipeline-surface)]",
  "border border-[var(--color-pipeline-line)]",
  "rounded-[var(--radius-pipeline-card)]",
  "flex flex-col",
  "w-full",
  "pt-4 px-2 pb-6",
].join(" ");

// Left identity section (icon + labels stacked)
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

// Numeric value — mirrors TokenInput's <input> visual style
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
      {/* Row: identity (icon + label + balance) + numeric value */}
      <div
        data-testid="token-amount-display-row"
        className="flex items-center justify-between pr-2"
      >
        {/* Left: coin icon + labels */}
        <div className={identityClasses}>
          <CoinIcon token={token} size="lg" aria-hidden />
          <div className="flex min-w-0 flex-col items-start justify-center">
            <span className={tokenLabelClasses}>{tokenLabel}</span>
            <span className={balanceLabelClasses}>{balanceLabel}</span>
          </div>
        </div>

        {/* Right: display-only numeric value */}
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
