import React from "react";
import { CoinIcon } from "../CoinIcon/CoinIcon";

/**
 * WalletPill — top-right connected-wallet chip.
 *
 * Renders a small CoinIcon at the `sm` size (20 px) alongside the formatted
 * balance string inside a rounded white pill with a subtle border.  Matches
 * the Figma node 1498:100168 ("button" in the header "Buttons" group).
 *
 * This is a purely visual element (`<div>`); interactive behaviour (click to
 * open wallet menu) will be added in a later issue.
 *
 * Design tokens used:
 *   - `--color-pipeline-surface`   — white pill fill
 *   - `--color-pipeline-ink`       — balance text colour
 *   - `--radius-pipeline-pill`     — full-round ends
 *   - Border: `rgba(56 55 53 / 0.18)` (border-test/secondary)
 *   - Height 48 px / px-3 — same bar height as other header buttons
 *
 * Supported tokens: `"usdc"`, `"plusd"`, `"splusd"`.
 */

export interface WalletPillProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Which coin token to display the icon for. */
  token: "usdc" | "plusd" | "splusd";
  /**
   * Pre-formatted balance string shown next to the coin icon,
   * e.g. `"$10,000.00"`.
   */
  balance: string;
}

// Outer pill — white surface, subtle border, fully rounded ends.
const pillClasses = [
  "inline-flex h-12 items-center justify-center",
  "gap-0",
  "overflow-hidden",
  "px-3",
  "rounded-[var(--radius-pipeline-pill)]",
  "bg-[var(--color-pipeline-surface)]",
  "border border-[rgb(56_55_53_/_0.18)]",
  "shrink-0",
].join(" ");

// Label — Body Emphasized: Graphik LC Semi Bold 16/22, primary ink.
const labelClasses = [
  "font-[family-name:var(--font-body)]",
  "text-[length:var(--text-pipeline-body)]",
  "leading-[var(--text-pipeline-body--line-height)]",
  "font-[var(--font-weight-emphasized)]",
  "text-[color:var(--color-pipeline-ink)]",
  "whitespace-nowrap",
  "px-2",
].join(" ");

export const WalletPill = React.forwardRef<HTMLDivElement, WalletPillProps>(
  function WalletPill({ token, balance, className, ...rest }, ref) {
    const composed = [pillClasses, className].filter(Boolean).join(" ");

    return (
      <div ref={ref} className={composed} {...rest}>
        <CoinIcon token={token} size="sm" aria-hidden />
        <span className={labelClasses}>{balance}</span>
      </div>
    );
  },
);

WalletPill.displayName = "WalletPill";

export default WalletPill;
