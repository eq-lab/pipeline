// spec: docs/frontend/dashboard-components.md#home-route (shared desktop grid shell, #1577).
import type { ReactNode } from "react";
import { RecentActivityCard } from "@/components/RecentActivityCard";
import { QnaSection } from "@/components/QnaSection";
import { StartHereCard } from "@/components/StartHereCard";
import { StakeCard } from "@/components/StakeCard";
import { EarnedCard } from "@/components/EarnedCard";

export interface HomeDashboardGridProps {
  hero: ReactNode;
  activityPadding?: "md";
  balancesNodeId?: string;
  balances: ReactNode;
  third: ReactNode;
  busy?: boolean;
}

export function HomeDashboardGrid({
  hero,
  activityPadding,
  balancesNodeId,
  balances,
  third,
  busy,
}: HomeDashboardGridProps) {
  return (
    <div
      className="grid w-full grid-cols-7 gap-4"
      data-testid="home-dashboard-grid"
      {...(busy ? { "aria-busy": true } : {})}
    >
      {hero}

      <div className="relative col-span-3 col-start-5 row-span-2 row-start-1">
        <RecentActivityCard
          className="!absolute inset-0 min-h-0 overflow-hidden"
          {...(activityPadding ? { padding: activityPadding } : {})}
          data-testid="home-recent-activity-card"
        />
      </div>

      <div
        className="col-span-2 col-start-1 row-start-2 flex flex-col gap-4"
        {...(balancesNodeId ? { "data-node-id": balancesNodeId } : {})}
        data-testid="home-balances-stack"
      >
        {balances}
      </div>

      {third}

      <div
        className="col-span-7 col-start-1 row-start-3"
        data-testid="home-qna-wrapper"
      >
        <QnaSection />
      </div>
    </div>
  );
}

export function LoadingBlock({ className }: { className: string }) {
  return (
    <div
      aria-hidden="true"
      data-testid="home-loading-block"
      className={`w-full animate-pulse rounded-[var(--radius-pipeline-card)] bg-[color:var(--color-pipeline-surface-muted)] ${className}`}
    />
  );
}

export interface CompactBalancesProps {
  onBuy: () => void;
  onSell: () => void;
  sellDisabled: boolean;
  onStake: () => void;
  onUnstake: () => void;
  stakeDisabled?: boolean;
  compactVariant?: "balance";
  compactBalanceLabel?: string;
}

export function CompactBalances({
  onBuy,
  onSell,
  sellDisabled,
  onStake,
  onUnstake,
  stakeDisabled,
  compactVariant,
  compactBalanceLabel,
}: CompactBalancesProps) {
  return (
    <>
      <StartHereCard
        layout="compact"
        onBuy={onBuy}
        onSell={onSell}
        sellDisabled={sellDisabled}
        {...(compactVariant ? { compactVariant, compactBalanceLabel } : {})}
        data-testid="home-start-here-card"
      />
      <StakeCard
        layout="compact"
        onStake={onStake}
        onUnstake={onUnstake}
        {...(stakeDisabled !== undefined ? { stakeDisabled } : {})}
        data-testid="home-stake-card"
      />
    </>
  );
}

export function CompactAddUsdStack({
  nodeId,
  children,
}: {
  nodeId: string;
  children: ReactNode;
}) {
  return (
    <div
      className="col-span-2 col-start-3 row-start-2 flex flex-col gap-4"
      data-node-id={nodeId}
      data-testid="home-add-usd-stack"
    >
      {children}
      <EarnedCard layout="compact" data-testid="home-earned-card" />
    </div>
  );
}
