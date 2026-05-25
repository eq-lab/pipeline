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
 *   - `onSwap`       — optional callback fired when the user clicks the swap
 *                      button to toggle direction (deposit ↔ withdraw). When
 *                      omitted, or when either side's `disabled` prop is true,
 *                      the button is rendered with the HTML `disabled` attribute
 *                      so it cannot fire during an in-flight wallet action.
 *
 * Design tokens used:
 *   - `--color-pipeline-surface`   — white card fill (Card `white` variant and Card A wrapper)
 *   - `--color-pipeline-fill-muted`  — swap button fill (subtle gray)
 *   - `--color-pipeline-surface-muted` — swap button hover fill
 *   - `--color-pipeline-line`      — card border
 *   - `--color-pipeline-ink-muted` — InfoRow label colour (via InfoRow)
 *   - `--color-pipeline-ink`       — InfoRow value colour (via InfoRow)
 *   - `--radius-pipeline-card`     — card corner radius (via Card, used for Card B)
 *   - `--radius-pipeline-card-lg`  — 16px outer card radius for Card A (USDC input section; Figma 1498:100136)
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
  /**
   * Called when the user clicks the swap-direction button between the two
   * token cards. When undefined, or when `input.disabled` is true, the button
   * is rendered with the HTML `disabled` attribute so it cannot fire during an
   * in-flight wallet action.
   */
  onSwap?: () => void;
}

// Swap button: absolutely positioned to straddle the 2px seam between the two
// cards. Anchored to the bottom edge of Card A's wrapper (`top-full`) and
// shifted up by half its own height (`-translate-y-1/2`) so it sits centered
// on the gap. The `left-1/2 -translate-x-1/2` centers it horizontally.
//
// Styling per Figma node 1498-100157:
//   - `rounded-[4px]`  — square-ish corners (not a full pill)
//   - size 32×32 (`size-8`) — quiet recessed affordance, not a boxy chip
//   - fill: --color-pipeline-fill-muted (subtle gray, same family as USDC panel)
//   - no visible border — design omits the hairline border
//   - cursor-pointer + focus ring consistent with TopBar pill trigger
//   - disabled:opacity-50 + disabled:cursor-not-allowed when button is disabled
const swapButtonClasses = [
  "absolute z-10",
  "left-1/2 -translate-x-1/2",
  "top-full -translate-y-1/2",
  "flex items-center justify-center",
  "size-8",
  "rounded-[4px]",
  "bg-[var(--color-pipeline-fill-muted)]",
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
  // Prefix the PLUSD output value with "+" when non-zero (purely visual).
  // Zero values stay un-prefixed to match the Figma "0" placeholder state.
  const outputValue = output.value && output.value !== "0"
    ? `+${output.value}`
    : output.value;

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
          White outer card matching Figma node 1498:100136 ("input-sum-inline"):
            - background: --color-pipeline-surface (white)
            - corner radius: --radius-pipeline-card-lg (16px)
            - padding: 16/16/24/16 (pt-4 pr-4 pb-6 pl-4)
            - no border (Figma shows none)
          `relative` enables the absolutely-positioned swap button to anchor
          to this card's bottom edge via `top-full`.
          signPrefix="−" shows the minus sign (outflow) when a non-zero value
          is present; the underlying input value stays positive. */}
      <div
        className="relative pt-4 pr-4 pb-6 pl-4 bg-[var(--color-pipeline-surface)] rounded-[var(--radius-pipeline-card-lg)]"
      >
        <TokenInput {...input} signPrefix="−" />

        {/* Swap button — straddles the seam between Card A and Card B.
            Fill: --color-pipeline-fill-muted (subtle gray, no border).
            Figma node 1498-100157.
            Disabled when onSwap is not provided or either side is disabled,
            so it cannot fire during an in-flight wallet action. */}
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
          value={outputValue}
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
