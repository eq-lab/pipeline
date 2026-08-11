import React from "react";
import { CoinIcon } from "../CoinIcon/CoinIcon";

/**
 * WalletPill — top-right connected-wallet balance chip.
 * spec: docs/frontend/ui-components.md#walletpill
 */

export interface WalletPillProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Which coin token to display the icon for. */
  token: "usdc" | "plusd" | "splusd";
  /** Pre-formatted balance string shown next to the coin icon, e.g. `"$10,000.00"`. */
  balance: string;
}

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
