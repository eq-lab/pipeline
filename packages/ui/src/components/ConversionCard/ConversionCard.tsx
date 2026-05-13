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
 * ConversionCard — full conversion UI card.
 *
 * Composes a white `Card` containing:
 *   1. `TokenInput` (top) — the token the user is selling (e.g. USDC).
 *   2. Swap-vertical icon divider — centered between the two token sections.
 *   3. `TokenAmountDisplay` (bottom) — the token the user is receiving (e.g. PLUSD).
 *   4. Two `InfoRow`s — `Exchange rate` and `Network fee`.
 *
 * Slots and props:
 *   - `input`        — props forwarded directly to `TokenInput`.
 *   - `output`       — props forwarded directly to `TokenAmountDisplay`.
 *   - `exchangeRate` — string displayed in the "Exchange rate" `InfoRow`.
 *   - `networkFee`   — string displayed in the "Network fee" `InfoRow`.
 *
 * Design tokens used:
 *   - `--color-pipeline-surface`   — white card fill (Card `white` variant)
 *   - `--color-pipeline-line`      — card border / divider line
 *   - `--color-pipeline-ink-muted` — InfoRow label colour (via InfoRow)
 *   - `--color-pipeline-ink`       — InfoRow value colour (via InfoRow)
 *   - `--radius-pipeline-card`     — card corner radius (via Card)
 *
 * Figma reference: node 1498-100130.
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
}

// Divider row: a horizontal line with the swap icon sitting centered on it.
// The line is painted with --color-pipeline-line to match the Card border.
// The icon is 24×24 in a 40×40 white pill so it reads clearly against the line.
const dividerRowClasses = "relative flex items-center justify-center";

const dividerLineClasses = [
  "absolute inset-x-0 top-1/2 -translate-y-1/2",
  "h-px",
  "bg-[var(--color-pipeline-line)]",
].join(" ");

// The swap icon is an <img> rather than a CSS mask because the asset embeds a
// raster PNG which cannot be recoloured via `currentColor`.  We place it on a
// white surface pill so it is visible against the line.
const swapIconWrapperClasses = [
  "relative z-10",
  "flex items-center justify-center",
  "size-10",
  "rounded-full",
  "bg-[var(--color-pipeline-surface)]",
  "border border-[var(--color-pipeline-line)]",
].join(" ");

export const ConversionCard = React.forwardRef<
  HTMLDivElement,
  ConversionCardProps
>(function ConversionCard(
  { input, output, exchangeRate, networkFee, className, ...rest },
  ref,
) {
  return (
    <Card ref={ref} variant="white" className={className} {...rest}>
      <div className="flex flex-col gap-4">
        {/* Top: TokenInput — sell side */}
        <TokenInput {...input} />

        {/* Divider row with swap icon */}
        <div className={dividerRowClasses}>
          <div className={dividerLineClasses} aria-hidden="true" />
          <div className={swapIconWrapperClasses}>
            <img
              src={swapVerticalSrc}
              alt=""
              aria-hidden="true"
              width={22}
              height={22}
            />
          </div>
        </div>

        {/* Bottom: TokenAmountDisplay — receive side */}
        <TokenAmountDisplay {...output} />

        {/* Info rows */}
        <div className="flex flex-col gap-2 pt-2">
          <InfoRow label="Exchange rate" value={exchangeRate} />
          <InfoRow label="Network fee" value={networkFee} />
        </div>
      </div>
    </Card>
  );
});

ConversionCard.displayName = "ConversionCard";

export default ConversionCard;
