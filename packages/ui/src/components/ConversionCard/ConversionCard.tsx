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
 * Composes two white `Card`s stacked vertically with a 2px gap:
 *
 *   Card A (top) — `TokenInput` (USDC token row + quick-amount chips).
 *   Card B (bottom) — `TokenAmountDisplay` (PLUSD token row) **plus** the
 *     nested `Exchange rate` / `Network fee` details block.
 *
 * The swap-vertical icon button is absolutely positioned over the 2px seam
 * between the two cards (centered on the gap), with `rounded-[4px]` corners
 * and a white-to-paper gradient fill.
 *
 * Slots and props:
 *   - `input`        — props forwarded directly to `TokenInput`.
 *   - `output`       — props forwarded directly to `TokenAmountDisplay`.
 *   - `exchangeRate` — string displayed in the "Exchange rate" `InfoRow`.
 *   - `networkFee`   — string displayed in the "Network fee" `InfoRow`.
 *
 * Design tokens used:
 *   - `--color-pipeline-surface`   — white card fill (Card `white` variant)
 *   - `--color-pipeline-paper`     — gradient end-stop for swap button fill
 *   - `--color-pipeline-line`      — card border / swap button border
 *   - `--color-pipeline-ink-muted` — InfoRow label colour (via InfoRow)
 *   - `--color-pipeline-ink`       — InfoRow value colour (via InfoRow)
 *   - `--radius-pipeline-card`     — card corner radius (via Card)
 *
 * Figma reference: node 1498-100130 (input section, file A43rjYYjSwdTmiwwf5cx5n).
 * Swap button: Figma node 1498-100157.
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

// Swap button: absolutely positioned to straddle the 2px seam between the two
// cards. Anchored to the bottom edge of Card A's wrapper (`top-full`) and
// shifted up by half its own height (`-translate-y-1/2`) so it sits centered
// on the gap. The `left-1/2 -translate-x-1/2` centers it horizontally.
//
// Styling per Figma node 1498-100157:
//   - `rounded-[4px]`  — square-ish corners (not a full pill)
//   - gradient fill: white (--color-pipeline-surface) at top →
//     paper (#f8f7f6, --color-pipeline-paper) at bottom
//   - hairline border in --color-pipeline-line
const swapButtonClasses = [
  "absolute z-10",
  "left-1/2 -translate-x-1/2",
  "top-full -translate-y-1/2",
  "flex items-center justify-center",
  "size-10",
  "rounded-[4px]",
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
    /* Outer wrapper: two cards stacked with a 2px gap.
       `relative` is NOT needed here — Card A's wrapper carries `relative`
       so the swap button is positioned relative to Card A's bottom edge. */
    <div
      ref={ref}
      className={["flex flex-col gap-[2px]", className]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {/* Card A (top): TokenInput — sell side (USDC).
          `relative` enables the absolutely-positioned swap button to anchor
          to this card's bottom edge via `top-full`. */}
      <div className="relative">
        <TokenInput {...input} />

        {/* Swap button — straddles the seam between Card A and Card B.
            Gradient: surface (#ffffff) → paper (#f8f7f6), top-to-bottom.
            Figma node 1498-100157. */}
        <div
          className={swapButtonClasses}
          style={{
            background:
              "linear-gradient(180deg, var(--color-pipeline-surface) 0%, var(--color-pipeline-paper) 100%)",
          }}
          aria-hidden="true"
        >
          <img
            src={swapVerticalSrc}
            alt=""
            aria-hidden="true"
            width={22}
            height={22}
          />
        </div>
      </div>

      {/* Card B (bottom): TokenAmountDisplay (PLUSD) + Exchange rate / Network fee.
          Both live inside a single white Card so the Details block is visually
          nested within the PLUSD card, matching Figma node 1498-100135.
          TokenAmountDisplay's self-styling (border, bg, radius, padding) is
          suppressed via inline styles so it renders flush inside Card B. */}
      <Card variant="white" className="flex flex-col gap-2">
        {/* PLUSD token row — card chrome stripped via inline styles so it
            sits flush inside the Card B wrapper without a nested border. */}
        <TokenAmountDisplay
          {...output}
          style={{
            border: "none",
            background: "transparent",
            borderRadius: 0,
            padding: "16px 8px 0",
          }}
        />

        {/* Details: Exchange rate + Network fee — nested inside Card B */}
        <div className="flex flex-col gap-2 pb-2">
          <InfoRow label="Exchange rate" value={exchangeRate} />
          <InfoRow label="Network fee" value={networkFee} />
        </div>
      </Card>
    </div>
  );
});

ConversionCard.displayName = "ConversionCard";

export default ConversionCard;
