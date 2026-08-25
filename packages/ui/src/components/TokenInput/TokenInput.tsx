import React from "react";
import { CoinIcon } from "../CoinIcon/CoinIcon";
import { QuickAmountChip } from "../QuickAmountChip/QuickAmountChip";

/**
 * TokenInput — amount entry field with token identity and quick-amount chips.
 * spec: docs/frontend/ui-components.md#tokeninput
 */

export interface QuickAmountItem {
  /** Display label, e.g. "$1,000 (Min)", "$5,000", "Max". */
  label: string;
  /** Whether this chip is currently selected. */
  selected?: boolean;
  /** When true, the chip is disabled; forwarded to `QuickAmountChip`. */
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
  /** Controlled value for the numeric input; when omitted the input stays uncontrolled. */
  value?: string;
  /** Fired on every keystroke; only used when `value` is provided (controlled mode). */
  onValueChange?: (next: string) => void;
  /** When true, the numeric input and all chips are disabled. */
  disabled?: boolean;
  /**
   * Optional presentational sign prefix (e.g. "−") — never part of the
   * `<input>` value; shown only when `value` is non-empty and not "0".
   */
  signPrefix?: string;
  /**
   * `data-testid` for the inner numeric `<input>` — the `...rest` spread
   * targets the wrapper `<div>`, so tests need this to reach the field.
   */
  inputTestId?: string;
}

const cardClasses = [
  "bg-[var(--color-pipeline-fill-muted)]",
  "border border-[var(--color-pipeline-line)]",
  "rounded-lg",
  "flex flex-col",
  "w-full",
  "p-2",
  "gap-8",
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

const inputClasses = [
  "bg-transparent outline-none border-none",
  "font-[family-name:var(--font-display)]",
  "text-[24px] leading-[28px]",
  "font-normal",
  "text-[color:var(--color-pipeline-ink-subtle)]",
  "text-right",
  // field-sizing-content shrinks/grows the input to its typed value so the
  // sign prefix sits flush against the first digit (no w-full stretch).
  "[field-sizing:content]",
  "caret-[var(--color-pipeline-ink)]",
  "focus:outline-none",
  "placeholder:text-[color:var(--color-pipeline-ink-subtle)]",
].join(" ");

// No width/alignment overrides — the span is sized to its content only so it
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

    const showSign = signPrefix !== undefined && !!value && value !== "0";
    const showBalance =
      !!balanceLabel &&
      balanceLabel !== "—" &&
      !/^0(\.0+)?$/.test(balanceLabel.replace(/,/g, ""));

    const inputRef = React.useRef<HTMLInputElement>(null);

    const handleCardClick = (e: React.MouseEvent<HTMLDivElement>) => {
      if (disabled || !inputRef.current) return;
      const target = e.target as HTMLElement;
      if (target === inputRef.current) return;
      if (target.closest('[data-testid="token-input-chips"]')) return;
      inputRef.current.focus();
    };

    return (
      <div
        ref={ref}
        data-testid="token-input"
        className={composed}
        onClick={handleCardClick}
        {...rest}
      >
        <div
          data-testid="token-input-row"
          className="flex items-center justify-between pr-2"
        >
          <div className={identityClasses}>
            <CoinIcon token={token} size="lg" aria-hidden />
            <div
              className={[
                "flex min-w-0 flex-col items-start",
                showSign ? "justify-start" : "justify-center",
              ].join(" ")}
            >
              <span className={tokenLabelClasses}>{tokenLabel}</span>
              {showBalance && (
                <span className={balanceLabelClasses}>{balanceLabel}</span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-start justify-end">
            {showSign && (
              <span className={signPrefixClasses} aria-hidden="true">
                {signPrefix}
              </span>
            )}
            <input
              ref={inputRef}
              type="text"
              inputMode="decimal"
              className={inputClasses}
              placeholder={placeholderValue}
              aria-label={`${tokenLabel} amount`}
              data-testid={inputTestId}
              // Sizing: wide enough for typical amounts, collapses naturally
              size={8}
              value={value ?? undefined}
              onChange={
                onValueChange ? (e) => onValueChange(e.target.value) : undefined
              }
              disabled={disabled}
            />
          </div>
        </div>

        <div
          data-testid="token-input-chips"
          className="flex w-full items-center gap-1"
        >
          {quickAmounts.map((item, idx) => (
            <QuickAmountChip
              key={idx}
              label={item.label}
              selected={item.selected}
              disabled={disabled || item.disabled}
              onClick={
                !disabled && onQuickAmountClick
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
