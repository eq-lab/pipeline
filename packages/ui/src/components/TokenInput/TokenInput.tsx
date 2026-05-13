import React from "react";
import { CoinIcon } from "../CoinIcon/CoinIcon";
import { QuickAmountChip } from "../QuickAmountChip/QuickAmountChip";

/**
 * TokenInput — top half of the conversion card.
 *
 * Renders:
 *   - Token coin icon (CoinIcon at lg/40 px) + token label + balance subtitle
 *   - A large display-serif numeric input (right-aligned, with cursor indicator)
 *   - A row of QuickAmountChip buttons
 *
 * Styling only — the <input> is rendered but there is no controlled-value
 * logic, validation, or formatting in this issue.
 *
 * Design tokens used:
 *   - `--color-pipeline-surface`         — white card fill
 *   - `--color-pipeline-paper`           — outer background (focus ring offset)
 *   - `--color-pipeline-ink`             — primary text
 *   - `--color-pipeline-ink-muted`       — balance subtitle, muted text
 *   - `--color-pipeline-ink-subtle`      — placeholder digit colour
 *   - `--color-pipeline-line`            — card border
 *   - `--color-pipeline-brand`           — focus-visible ring on input
 *   - `--radius-pipeline-card`           — card corner radius
 *   - `--font-display`, `--font-body`    — typeface families
 *   - `--text-pipeline-*` size/lh pairs
 *   - `--font-weight-emphasized`
 *
 * Figma reference: node 1498-100136 (USDC value container) in file A43rjYYjSwdTmiwwf5cx5n
 */

export interface QuickAmountItem {
  /** Display label, e.g. "$1,000 (Min)", "$5,000", "Max". */
  label: string;
  /** Whether this chip is currently selected. */
  selected?: boolean;
}

export interface TokenInputProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "onChange"
> {
  /** Which coin token to display. */
  token: "usdc" | "plusd";
  /** Token label shown next to the coin, e.g. "USDC". */
  tokenLabel: string;
  /** Pre-formatted balance string, e.g. "10,000.00". */
  balanceLabel: string;
  /** Placeholder value shown in muted ink when there is no value, e.g. "0". */
  placeholderValue?: string;
  /** Row of quick-amount chips to display. */
  quickAmounts: QuickAmountItem[];
  /** Called when a quick-amount chip is clicked. Receives the chip index. */
  onQuickAmountClick?: (index: number, item: QuickAmountItem) => void;
}

// Outer card — white fill, subtle border, card radius.
const cardClasses = [
  "bg-[var(--color-pipeline-surface)]",
  "border border-[var(--color-pipeline-line)]",
  "rounded-[var(--radius-pipeline-card)]",
  "flex flex-col",
  "w-full",
  "pt-4 px-2 pb-6",
  "gap-8",
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

// Numeric input — display serif, right-aligned, large
// Uses a real <input> element for accessibility; styling-only (no controlled logic yet).
const inputClasses = [
  // Invisible native input sitting behind the visual display
  "bg-transparent outline-none border-none",
  "font-[family-name:var(--font-display)]",
  "text-[24px] leading-[28px]",
  "font-normal",
  "text-[color:var(--color-pipeline-ink-subtle)]",
  "text-right",
  "w-full",
  // Caret styled to match design (thin ink-coloured bar)
  "caret-[var(--color-pipeline-ink)]",
  // Focus ring on the overall card, not just the input
  "focus:outline-none",
  "placeholder:text-[color:var(--color-pipeline-ink-subtle)]",
].join(" ");

export const TokenInput = React.forwardRef<HTMLDivElement, TokenInputProps>(
  function TokenInput(
    {
      token,
      tokenLabel,
      balanceLabel,
      placeholderValue = "0",
      quickAmounts,
      onQuickAmountClick,
      className,
      ...rest
    },
    ref,
  ) {
    const composed = [cardClasses, className].filter(Boolean).join(" ");

    return (
      <div ref={ref} className={composed} {...rest}>
        {/* Top row: identity (icon + label + balance) + numeric input */}
        <div className="flex items-center justify-between pr-2">
          {/* Left: coin icon + labels */}
          <div className={identityClasses}>
            <CoinIcon token={token} size="lg" aria-hidden />
            <div className="flex min-w-0 flex-col items-start justify-center">
              <span className={tokenLabelClasses}>{tokenLabel}</span>
              <span className={balanceLabelClasses}>{balanceLabel}</span>
            </div>
          </div>

          {/* Right: numeric input */}
          <div className="flex shrink-0 items-start justify-end">
            <input
              type="text"
              inputMode="decimal"
              className={inputClasses}
              placeholder={placeholderValue}
              aria-label={`${tokenLabel} amount`}
              // Sizing: wide enough for typical amounts, collapses naturally
              size={8}
            />
          </div>
        </div>

        {/* Bottom row: quick-amount chips */}
        <div className="flex w-full items-center gap-1">
          {quickAmounts.map((item, idx) => (
            <QuickAmountChip
              key={idx}
              label={item.label}
              selected={item.selected}
              onClick={
                onQuickAmountClick
                  ? () => onQuickAmountClick(idx, item)
                  : undefined
              }
              className="flex-1"
            />
          ))}
        </div>
      </div>
    );
  },
);

TokenInput.displayName = "TokenInput";

export default TokenInput;
