import React from "react";
import { Link } from "@tanstack/react-router";
import { Stat } from "@pipeline/ui";
import { useStakedPlusdConvertToAssets } from "@/wallet/evm/useStakedPlusd";
import { useStats, formatApy } from "@/api";

// spec: docs/frontend/dashboard-components.md#homestatsstrip (desktop/mobile reuse, Figma frame 1989:8292).

// External-link arrow icon — inline SVG so it paints with currentColor and
// inherits the ink-muted token without a separate asset import.
function ExternalLinkIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={24}
      height={24}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M10.5 4.25C10.9142 4.25 11.25 4.58579 11.25 5C11.25 5.41422 10.9142 5.75 10.5 5.75H8.2002C7.62777 5.75 7.24315 5.75024 6.94727 5.77442C6.66027 5.79788 6.52316 5.84059 6.43262 5.88672C6.19751 6.00655 6.00655 6.19751 5.88672 6.43262C5.84059 6.52316 5.79788 6.66027 5.77442 6.94727C5.75024 7.24315 5.75 7.62777 5.75 8.2002V15.7998C5.75 16.3722 5.75024 16.7569 5.77442 17.0527C5.79788 17.3397 5.84059 17.4768 5.88672 17.5674C6.00655 17.8025 6.19751 17.9935 6.43262 18.1133L6.51075 18.1475C6.601 18.1798 6.73202 18.208 6.94727 18.2256C7.24315 18.2498 7.62777 18.25 8.2002 18.25H15.7998C16.3722 18.25 16.7569 18.2498 17.0527 18.2256C17.3397 18.2021 17.4768 18.1594 17.5674 18.1133L17.6533 18.0654C17.8492 17.9453 18.0084 17.7732 18.1133 17.5674L18.1475 17.4893C18.1798 17.399 18.208 17.268 18.2256 17.0527C18.2498 16.7569 18.25 16.3722 18.25 15.7998V13.5C18.25 13.0858 18.5858 12.75 19 12.75C19.4142 12.75 19.75 13.0858 19.75 13.5V15.7998C19.75 16.3475 19.751 16.8037 19.7207 17.1748C19.6935 17.5072 19.6382 17.8217 19.5098 18.1211L19.4502 18.2481C19.2195 18.7008 18.8683 19.0795 18.4375 19.3438L18.2481 19.4502C17.9109 19.6219 17.5545 19.6897 17.1748 19.7207C16.8037 19.751 16.3475 19.75 15.7998 19.75H8.2002C7.65252 19.75 7.19633 19.751 6.8252 19.7207C6.49281 19.6935 6.1783 19.6382 5.87891 19.5098L5.75196 19.4502C5.23451 19.1865 4.81346 18.7655 4.54981 18.2481C4.3781 17.9109 4.31033 17.5545 4.2793 17.1748C4.24898 16.8037 4.25 16.3475 4.25 15.7998V8.2002C4.25 7.65252 4.24898 7.19633 4.2793 6.8252C4.31033 6.44547 4.3781 6.0891 4.54981 5.75196C4.81346 5.23451 5.23451 4.81346 5.75196 4.54981C6.0891 4.3781 6.44547 4.31033 6.8252 4.2793C7.19633 4.24898 7.65252 4.25 8.2002 4.25H10.5Z" />
      <path d="M19.0772 4.25391C19.4551 4.29253 19.75 4.61184 19.75 5V10.5C19.75 10.9142 19.4142 11.25 19 11.25C18.5858 11.25 18.25 10.9142 18.25 10.5V6.81055L11.5303 13.5303C11.2374 13.8232 10.7626 13.8232 10.4697 13.5303C10.1768 13.2374 10.1768 12.7626 10.4697 12.4697L17.1895 5.75H13.5C13.0858 5.75 12.75 5.41422 12.75 5C12.75 4.58579 13.0858 4.25001 13.5 4.25H19L19.0772 4.25391Z" />
    </svg>
  );
}

// spec: docs/frontend/dashboard-components.md#homestatsstrip (Figma nodes 1497:94562 / 1497:94563).
const separatedCellClasses = [
  "pl-3",
  "border-l border-solid",
  "border-[color:var(--color-pipeline-line)]",
].join(" ");

// spec: docs/frontend/dashboard-components.md#homestatsstrip (Figma node 1497:94564).
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

  const composed = ["flex items-center gap-4", "shrink-0", className]
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

      {/* External-link icon button — opens the Protocol Dashboard (#716). */}
      <Link
        to="/dashboard"
        aria-label="View Protocol Dashboard"
        className={iconButtonClasses}
        data-testid="home-stats-dashboard-link"
      >
        <span className="inline-flex size-6 items-center justify-center">
          <ExternalLinkIcon />
        </span>
      </Link>
    </div>
  );
}

export default HomeStatsStrip;
