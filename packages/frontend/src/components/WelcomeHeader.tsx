import React from "react";
import { Stat } from "@pipeline/ui";
import { useStakedPlusdConvertToAssets } from "@/wallet/useStakedPlusd";
import { useStats, formatApy } from "@/api";

/**
 * WelcomeHeader — Dashboard top heading with stats strip.
 *
 * Implements Figma frame 1497:94558 ("Title" row inside "Heading"):
 *   - Left: large "Welcome" display heading in Besley serif, ink-subtle colour.
 *   - Right: stats strip with three Stat readouts separated by hairline
 *     left-borders, plus a trailing external-link icon button.
 *
 * The exchange rate and APY stats are live — sourced from
 * `useStakedPlusdConvertToAssets` and `useStats` respectively.
 * TVL remains hardcoded (separate issue).
 * All visual values come from design tokens in `@pipeline/ui/styles/theme.css`.
 */

// External-link arrow icon rendered as an inline SVG so it paints with
// `currentColor` and inherits the surrounding ink-muted token without a
// separate SVG import that would require Vite URL resolution.
function ExternalLinkIcon() {
  return (
    <svg
      viewBox="0 0 13 13"
      width={13}
      height={13}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12.4999 10.75C12.4999 11.1642 12.1642 11.5 11.7499 11.5C11.3357 11.5 10.9999 11.1642 10.9999 10.75V2.56055L1.28022 12.2803C0.987324 12.5732 0.512563 12.5732 0.21967 12.2803C-0.0732233 11.9874 -0.0732233 11.5126 0.21967 11.2197L9.9394 1.5H1.74994C1.33573 1.5 0.999943 1.16421 0.999943 0.75C0.999943 0.335786 1.33573 0 1.74994 0H11.7499C12.1642 0 12.4999 0.335786 12.4999 0.75V10.75Z" />
    </svg>
  );
}

export type WelcomeHeaderProps = React.HTMLAttributes<HTMLDivElement>;

// Outer row: heading left, stats strip right, aligned to the bottom edge
// (items-end mirrors Figma's "end" alignment on node 1497:94558).
const rootClasses = [
  "flex w-full gap-12 items-end justify-center",
  "px-0",
].join(" ");

// "Welcome" heading — display-serif, title scale (64px/64px), ink-subtle.
const headingClasses = [
  "flex-1 min-w-0",
  "font-[family-name:var(--font-display)]",
  "font-normal",
  "text-[length:var(--text-pipeline-title)]",
  "leading-[var(--text-pipeline-title--line-height)]",
  "text-[color:var(--color-pipeline-ink-subtle)]",
  "whitespace-nowrap",
].join(" ");

// Stats strip wrapper — flex row, items aligned to centre vertically,
// gaps of 16px between cells (Figma gap-16 on node 1497:94560).
const stripClasses = ["flex items-center gap-4", "shrink-0"].join(" ");

// Separator cell — adds hairline left-border + left-padding matching
// Figma's divided list-item pattern (nodes 1497:94562 / 1497:94563).
const separatedCellClasses = [
  "pl-3",
  "border-l border-solid",
  "border-[color:var(--color-pipeline-line)]",
].join(" ");

// External-link icon button — 40×40 tap target matching Figma node 1497:94564
// (max-w/h 40px, borderless, rounded). Renders ink-muted icon.
const iconButtonClasses = [
  "inline-flex items-center justify-center",
  "size-10 px-2",
  "rounded-[var(--radius-pipeline-button)]",
  "text-[color:var(--color-pipeline-ink-muted)]",
  "cursor-pointer",
  "hover:bg-[color-mix(in_oklab,var(--color-pipeline-ink)_8%,transparent)]",
  "active:bg-[color-mix(in_oklab,var(--color-pipeline-ink)_14%,transparent)]",
  "focus:outline-none",
  "focus-visible:ring-2 focus-visible:ring-offset-2",
  "focus-visible:ring-offset-[var(--color-pipeline-paper)]",
  "focus-visible:ring-[var(--color-pipeline-brand)]",
].join(" ");

export function WelcomeHeader({ className, ...rest }: WelcomeHeaderProps) {
  const composed = [rootClasses, className].filter(Boolean).join(" ");

  const { data: rateRaw } = useStakedPlusdConvertToAssets(10n ** 18n);
  const exchangeRateValue =
    rateRaw !== undefined
      ? `1 sPLUSD = ${(Number(rateRaw) / 1e18).toFixed(4)} PLUSD`
      : "—";

  const { data: statsData } = useStats();
  const apyValue = formatApy(statsData?.vaults[0]?.apy);

  return (
    <div className={composed} {...rest}>
      {/* Left: display heading */}
      <h1 className={headingClasses}>Welcome</h1>

      {/* Right: stats strip */}
      <div className={stripClasses}>
        {/* Exchange rate — no left-border on the first cell */}
        <Stat label="Exchange rate" value={exchangeRateValue} />

        {/* Total Value Locked */}
        <div className={separatedCellClasses}>
          <Stat label="Total Value Locked" value="$28,812,044.93" />
        </div>

        {/* Current APY */}
        <div className={separatedCellClasses}>
          <Stat label="Current APY" value={apyValue} />
        </div>

        {/* External-link icon button */}
        <a href="#" aria-label="View details" className={iconButtonClasses}>
          <span className="inline-flex size-6 items-center justify-center">
            <ExternalLinkIcon />
          </span>
        </a>
      </div>
    </div>
  );
}

export default WelcomeHeader;
