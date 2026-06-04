import React from "react";
import { Stat } from "@pipeline/ui";
import { useStakedPlusdConvertToAssets } from "@/wallet/evm/useStakedPlusd";
import { useStats, formatApy } from "@/api";

/**
 * HomeStatsStrip — Exchange rate / TVL / Current APY stat row.
 *
 * Extracted from `WelcomeHeader` so the same live stats can be rendered in
 * two places without prop-drilling or duplication:
 *
 *   - **Desktop**: inside `WelcomeHeader` on the right side of the heading row.
 *   - **Mobile**: as a horizontally-scrollable strip at the bottom of the home
 *     page (`routes/index.tsx`) per the Figma mobile frame `1989:8292`.
 *
 * Catalogued in `docs/frontend/utils.md`.
 *
 * Figma refs: stat cells from nodes 1989:9048, 1989:9049, 1989:9050, 1989:9051.
 */

// External-link arrow icon — inline SVG so it paints with currentColor and
// inherits the ink-muted token without a separate asset import.
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
      <path d="M12.4999 10.75C12.4999 11.1642 12.1642 11.5 11.7499 11.5C11.3357 11.5 10.9999 11.1642 10.9999 10.75V2.56055L1.28022 12.2803C0.987324 12.5732 0.512563 12.5732 0.21967 12.2803C-0.0732233 11.9874 -0.0732233 11.5126 0.21967 11.2197L9.9394 1.5H1.74994C1.33573 1.5 0.999943 1.16421 0.999943 0.75C0.999943 0.335786 1.33573 0 1.74994 0H11.7499C12.4999 0 12.4999 0.335786 12.4999 0.75V10.75Z" />
    </svg>
  );
}

// Separator cell — adds hairline left-border + left-padding matching
// Figma's divided list-item pattern (nodes 1497:94562 / 1497:94563).
const separatedCellClasses = [
  "pl-3",
  "border-l border-solid",
  "border-[color:var(--color-pipeline-line)]",
].join(" ");

// External-link icon button — 40×40 tap target matching Figma node 1497:94564.
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

export type HomeStatsStripProps = React.HTMLAttributes<HTMLDivElement>;

export function HomeStatsStrip({ className, ...rest }: HomeStatsStripProps) {
  const { data: rateRaw } = useStakedPlusdConvertToAssets(10n ** 18n);
  const exchangeRateValue =
    rateRaw !== undefined
      ? `1 sPLUSD = ${(Number(rateRaw) / 1e18).toFixed(4)} PLUSD`
      : "—";

  const { data: statsData } = useStats();
  const apyValue = formatApy(statsData?.vaults[0]?.apy);

  const composed = [
    "flex items-center gap-4",
    "shrink-0",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={composed} {...rest} data-testid="home-stats-strip">
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
  );
}

export default HomeStatsStrip;
