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
 *   - `--color-pipeline-fill-muted`      — subtle gray panel background
 *   - `--color-pipeline-paper`           — outer background (focus ring offset)
 *   - `--color-pipeline-ink`             — primary text
 *   - `--color-pipeline-ink-muted`       — balance subtitle, muted text
 *   - `--color-pipeline-ink-subtle`      — placeholder digit colour
 *   - `--color-pipeline-brand`           — focus-visible ring on input
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
  /**
   * When true, the chip is disabled (e.g. the amount input is locked to an
   * active on-chain request). Forwarded to `QuickAmountChip` which already
   * handles the disabled visual state natively via `disabled:opacity-50
   * disabled:cursor-not-allowed`. Existing call sites that omit this prop
   * render unchanged.
   */
  disabled?: boolean;
}

export interface TokenInputProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "onChange"
> {
  /** Which coin token to display. */
  token: "usdc" | "plusd" | "splusd";
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
  /**
   * Controlled value for the numeric input. When provided the input is
   * controlled; when omitted it remains uncontrolled (existing behaviour).
   */
  value?: string;
  /**
   * Fired on every keystroke when the input value changes.
   * Only used when `value` is provided (controlled mode).
   */
  onValueChange?: (next: string) => void;
  /**
   * When true, the numeric input is disabled (e.g. wallet disconnected or
   * data not yet loaded). Existing call sites that omit this prop continue
   * to render an enabled input unchanged.
   */
  disabled?: boolean;
  /**
   * Optional sign prefix rendered visually to the left of the numeric input
   * in the same display-serif style (e.g. "−" for outflow). The prefix is
   * purely presentational — it is never part of the `<input>` value passed
   * back via `onValueChange`. Only shown when `value` is non-empty and not "0".
   */
  signPrefix?: string;
  /**
   * Optional `data-testid` applied directly to the inner numeric `<input>`
   * element (not the wrapper). The component's own `...rest` spread targets
   * the wrapper `<div>`, so this prop is the supported way to give tests a
   * stable handle on the field itself.
   */
  inputTestId?: string;
}

// Outer panel — subtle gray fill, 1px hairline border, 8px radius, uniform 8px padding.
const cardClasses = [
  "bg-[var(--color-pipeline-fill-muted)]",
  "border border-[var(--color-pipeline-line)]",
  "rounded-lg",
  "flex flex-col",
  "w-full",
  "p-2",
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
  // field-sizing-content makes the input shrink/grow to fit its typed value,
  // so the sign prefix sits flush against the first digit (no w-full stretch).
  "[field-sizing:content]",
  // Caret styled to match design (thin ink-coloured bar)
  "caret-[var(--color-pipeline-ink)]",
  // Focus ring on the overall card, not just the input
  "focus:outline-none",
  "placeholder:text-[color:var(--color-pipeline-ink-subtle)]",
].join(" ");

// Sign prefix span — same font/size/colour as the input but no width or
// text-alignment overrides; the span is sized to its content only so it
// sits flush against the number with no gap.
const signPrefixClasses = [
  "font-[family-name:var(--font-display)]",
  "text-[24px] leading-[28px]",
  "font-normal",
  "text-[color:var(--color-pipeline-ink-subtle)]",
  "shrink-0",
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
      value,
      onValueChange,
      disabled,
      signPrefix,
      inputTestId,
      className,
      ...rest
    },
    ref,
  ) {
    const composed = [cardClasses, className].filter(Boolean).join(" ");

    // Only show the sign prefix when there is a non-empty, non-zero value.
    const showSign = signPrefix !== undefined && !!value && value !== "0";

    return (
      <div ref={ref} data-testid="token-input" className={composed} {...rest}>
        {/* Top row: identity (icon + label + balance) + numeric input */}
        <div
          data-testid="token-input-row"
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

          {/* Right: optional sign prefix + numeric input */}
          <div className="flex shrink-0 items-start justify-end">
            {showSign && (
              <span className={signPrefixClasses} aria-hidden="true">
                {signPrefix}
              </span>
            )}
            <input
              type="text"
              inputMode="decimal"
              className={inputClasses}
              placeholder={placeholderValue}
              aria-label={`${tokenLabel} amount`}
              data-testid={inputTestId}
              // Sizing: wide enough for typical amounts, collapses naturally
              size={8}
              // Controlled mode: when `value` is provided the input is
              // controlled; otherwise it falls back to uncontrolled behaviour.
              value={value ?? undefined}
              onChange={
                onValueChange ? (e) => onValueChange(e.target.value) : undefined
              }
              disabled={disabled}
            />
          </div>
        </div>

        {/* Bottom row: quick-amount chips */}
        <div
          data-testid="token-input-chips"
          className="flex w-full items-center gap-1"
        >
          {quickAmounts.map((item, idx) => (
            <QuickAmountChip
              key={idx}
              label={item.label}
              selected={item.selected}
              disabled={item.disabled}
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
