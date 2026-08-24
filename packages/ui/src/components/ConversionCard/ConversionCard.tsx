import React from "react";
import { Card } from "../Card/Card";
import { TokenInput, type TokenInputProps } from "../TokenInput/TokenInput";
import {
  TokenAmountDisplay,
  type TokenAmountDisplayProps,
} from "../TokenAmountDisplay/TokenAmountDisplay";
import { InfoRow } from "../InfoRow/InfoRow";
import swapVerticalSrc from "../../assets/icons/swap-vertical.svg";

/**
 * ConversionCard — full conversion UI card: two stacked token cards + swap button.
 * spec: docs/frontend/ui-components.md#conversioncard
 */

export interface ConversionCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Props forwarded to the top `TokenInput` (sell side). */
  input: TokenInputProps;
  /** Props forwarded to the bottom `TokenAmountDisplay` (receive side). */
  output: TokenAmountDisplayProps;
  /** Value shown in the "Exchange rate" InfoRow, e.g. "1 USDC = 1 PLUSD". */
  exchangeRate: string;
  /** Value shown in the "Network fee" InfoRow, e.g. "~$1.20". */
  networkFee: string;
  /** Swap-direction callback; when undefined (or `input.disabled`) the button renders disabled. */
  onSwap?: () => void;
}

// Straddles the 2px seam: anchored to Card A's bottom edge (top-full) and
// shifted up half its own height; left-1/2 -translate-x-1/2 centers it.
const swapButtonClasses = [
  "absolute z-10",
  "left-1/2 -translate-x-1/2",
  "top-full -translate-y-1/2",
  "flex items-center justify-center",
  "size-8",
  "rounded-[4px]",
  "bg-[var(--color-pipeline-paper)]",
  "hover:bg-[var(--color-pipeline-surface-muted)]",
  "cursor-pointer",
  "disabled:opacity-50 disabled:cursor-not-allowed",
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
  "focus-visible:outline-[var(--color-pipeline-ink)]",
].join(" ");

export const ConversionCard = React.forwardRef<
  HTMLDivElement,
  ConversionCardProps
>(function ConversionCard(
  { input, output, exchangeRate, networkFee, onSwap, className, ...rest },
  ref,
) {
  // "+" prefix is purely visual and only for non-zero values (spec).
  const outputValue =
    output.value && output.value !== "0" ? `+${output.value}` : output.value;

  return (
    /* `relative` deliberately lives on Card A's wrapper, not here, so the swap
       button anchors to Card A's bottom edge. */
    <div
      ref={ref}
      className={["flex flex-col gap-[2px]", className]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {/* Card A (top): sell side. signPrefix="−" shows the outflow sign while
          the underlying input value stays positive. */}
      <div
        data-testid="conversion-input-card"
        className="relative rounded-[var(--radius-pipeline-card)] bg-[var(--color-pipeline-surface)] pt-4 pr-4 pb-6 pl-4"
      >
        <TokenInput {...input} signPrefix="−" />

        {/* Disabled so it cannot fire during an in-flight wallet action. */}
        <button
          type="button"
          aria-label="Switch direction"
          onClick={onSwap}
          disabled={!onSwap || input.disabled === true}
          className={swapButtonClasses}
        >
          <img
            src={swapVerticalSrc}
            alt=""
            aria-hidden="true"
            width={22}
            height={22}
          />
        </button>
      </div>

      {/* Card B (bottom): receive side + details. TokenAmountDisplay's own chrome
          is suppressed via inline styles below so it renders flush inside the Card. */}
      <Card
        variant="white"
        padding="none"
        data-testid="conversion-output-card"
        className="flex flex-col gap-8 border-0 px-4 pt-6 pb-4"
      >
        <TokenAmountDisplay
          {...output}
          value={outputValue}
          style={{
            border: "none",
            background: "transparent",
            borderRadius: 0,
            padding: 0,
          }}
        />

        <div data-testid="conversion-details" className="flex flex-col gap-2">
          <InfoRow label="Exchange rate" value={exchangeRate} />
          <InfoRow label="Network fee" value={networkFee} />
        </div>
      </Card>
    </div>
  );
});

ConversionCard.displayName = "ConversionCard";

export default ConversionCard;
