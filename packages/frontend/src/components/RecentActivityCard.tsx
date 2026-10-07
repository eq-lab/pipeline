// spec: docs/frontend/dashboard-components.md#recentactivitycard
import React from "react";
import { Link } from "@tanstack/react-router";
import { ActivityEmptyIllustration, Card, EmptyState } from "@pipeline/ui";
import type { CardPadding } from "@pipeline/ui";
import { useEvmWallet, useStellarWallet, useWalletView } from "@/wallet";
import { useRequests } from "@/api";
import { renderRequestRow } from "@/components/activity/renderRequestRow";

export interface RecentActivityCardProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "children"
> {
  padding?: CardPadding;
}

const HEADING_ID_BASE = "recent-activity-card-title";

const ILLUSTRATION_WIDTH = 240;

const MAX_ROWS = 5;

export const RecentActivityCard = React.forwardRef<
  HTMLDivElement,
  RecentActivityCardProps
>(function RecentActivityCard({ className, padding, ...rest }, ref) {
  const instanceId = React.useId();
  const HEADING_ID = `${HEADING_ID_BASE}-${instanceId}`;

  const { kind } = useWalletView();
  const { isConnected: isEvmConnected } = useEvmWallet();
  const { isConnected: isStellarConnected } = useStellarWallet();
  const isConnected = kind === "stellar" ? isStellarConnected : isEvmConnected;
  const { data, isLoading, error } = useRequests();
  const requests = data?.requests ?? [];
  const showList = isConnected && !isLoading && !error && requests.length > 0;

  const composed = [
    "flex flex-col gap-4",
    "min-h-[564px] w-full",
    "!border-t !border-r-[3px] !border-b-[3px] !border-l",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Card
      ref={ref}
      variant="white"
      padding={padding}
      role="region"
      aria-labelledby={HEADING_ID}
      className={composed}
      data-node-id="1497:94567"
      {...rest}
    >
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
        data-node-id="1497:94568"
        data-testid="home-recent-activity-heading"
      >
        Recent activity
      </h2>

      <div
        className="flex min-h-0 flex-1 flex-col gap-4"
        data-node-id="1497:94569"
        data-testid="home-recent-activity-body"
      >
        {showList ? (
          <>
            <ul className="flex flex-col" data-testid="home-activity-list">
              {requests.slice(0, MAX_ROWS).map((item, i) => (
                <li key={i} data-testid={`home-activity-row-${i}`}>
                  {renderRequestRow(
                    item,
                    kind,
                    `home-activity-row-inner-${i}`,
                    "pb-4",
                  )}
                </li>
              ))}
            </ul>
            <Link
              to="/transactions"
              className={[
                "mt-auto self-end",
                "inline-flex items-center gap-1",
                "h-12 rounded-lg px-3",
                "no-underline transition-colors",
                "font-[family-name:var(--font-body)]",
                "text-[length:var(--text-pipeline-body)]",
                "leading-[var(--text-pipeline-body--line-height)]",
                "font-[var(--font-weight-emphasized)]",
                "text-[color:var(--color-pipeline-ink-muted)]",
                "hover:text-[color:var(--color-pipeline-ink)]",
              ].join(" ")}
              data-node-id="1497:95216"
              data-testid="home-view-all-activity"
            >
              <span>View All </span>
              <span className="inline-flex size-6 items-center justify-center">
                <ChevronRight />
              </span>
            </Link>
          </>
        ) : (
          <EmptyState
            illustration={
              <ActivityEmptyIllustration
                tone="muted"
                width={ILLUSTRATION_WIDTH}
                data-node-id="1497:94570"
              />
            }
            caption="You will see all transactions here"
            data-node-id="1497:94665"
          />
        )}
      </div>
    </Card>
  );
});

function ChevronRight() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

RecentActivityCard.displayName = "RecentActivityCard";

export default RecentActivityCard;
