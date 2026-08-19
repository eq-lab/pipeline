import React from "react";
import { Link } from "@tanstack/react-router";
import { Card } from "@pipeline/ui";

/**
 * Total Balance card — real balance/PnL header with an honest empty chart
 * region until a per-address balance-history series exists (#1114).
 * spec: docs/frontend/dashboard-components.md#portfolioplaceholdercard.
 */

export type MobileHomeState = "empty" | "plusd" | "splusd";

export interface PortfolioPlaceholderCardProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "children"
> {
  mobileHomeState?: MobileHomeState;
  balanceLabel?: string;
  unrealizedPnlLabel?: string;
}

const HEADING_ID_BASE = "portfolio-placeholder-card-title";

export const PortfolioPlaceholderCard = React.forwardRef<
  HTMLDivElement,
  PortfolioPlaceholderCardProps
>(function PortfolioPlaceholderCard(
  {
    className,
    mobileHomeState,
    balanceLabel = "$0.00",
    unrealizedPnlLabel = "$0.00 unrealized",
    ...rest
  },
  ref,
) {
  const instanceId = React.useId();
  const HEADING_ID = `${HEADING_ID_BASE}-${instanceId}`;

  const composed = [
    "relative flex flex-col gap-6",
    "min-h-[274px] w-full",
    "overflow-hidden",
    "!border-t !border-r-[3px] !border-b-[3px] !border-l",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Card
      ref={ref}
      variant="yellow"
      role="region"
      aria-labelledby={HEADING_ID}
      className={composed}
      data-node-id="1497:95048"
      {...rest}
    >
      <div className="flex flex-col items-start gap-4 md:flex-row md:items-start md:justify-between">
        <header className="flex flex-col gap-1">
          <span
            className={[
              "font-[family-name:var(--font-body)]",
              "text-[length:var(--text-pipeline-caption)]",
              "leading-[var(--text-pipeline-caption--line-height)]",
              "font-[var(--font-weight-regular)]",
              "text-[color:var(--color-pipeline-ink-muted)]",
            ].join(" ")}
          >
            Total Balance
          </span>

          <h2
            id={HEADING_ID}
            className={[
              "font-[family-name:var(--font-display)]",
              "text-[length:var(--text-pipeline-heading-m)]",
              "leading-[var(--text-pipeline-heading-m--line-height)]",
              "font-[var(--font-weight-regular)]",
              "text-[color:var(--color-pipeline-ink)]",
              "m-0",
            ].join(" ")}
          >
            {balanceLabel}
          </h2>

          <span
            data-testid="earning-caption"
            className={[
              "font-[family-name:var(--font-body)]",
              "text-[length:var(--text-pipeline-caption)]",
              "leading-[var(--text-pipeline-caption--line-height)]",
              "font-[var(--font-weight-regular)]",
              "text-[color:var(--color-pipeline-ink-muted)]",
            ].join(" ")}
          >
            {unrealizedPnlLabel}
          </span>

          {mobileHomeState === "splusd" ? null : (
            <Link
              to={mobileHomeState === "plusd" ? "/stake" : "/deposit"}
              search={
                mobileHomeState === "plusd"
                  ? { tab: "stake" as const }
                  : { direction: "deposit" as const }
              }
              className={[
                "font-[family-name:var(--font-body)]",
                "text-[length:var(--text-pipeline-caption)]",
                "leading-[var(--text-pipeline-caption--line-height)]",
                "font-[var(--font-weight-regular)]",
                "text-[color:var(--color-pipeline-ink-muted)]",
                "underline-offset-2 hover:underline",
                "no-underline",
              ].join(" ")}
            >
              {mobileHomeState === "plusd"
                ? "Stake PLUSD to start earning"
                : "Get PLUSD to start"}
            </Link>
          )}
        </header>
      </div>

      <div
        className="flex flex-1 items-end"
        data-node-id="1497:95048-chart"
        data-testid="balance-history-empty"
      >
        <span
          className={[
            "pb-2",
            "font-[family-name:var(--font-body)]",
            "text-[length:var(--text-pipeline-caption)]",
            "leading-[var(--text-pipeline-caption--line-height)]",
            "text-[color:var(--color-pipeline-ink-muted)]",
          ].join(" ")}
        >
          Balance history will appear here once it&apos;s tracked.
        </span>
      </div>
    </Card>
  );
});

PortfolioPlaceholderCard.displayName = "PortfolioPlaceholderCard";

export default PortfolioPlaceholderCard;
