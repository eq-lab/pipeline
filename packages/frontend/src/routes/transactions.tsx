import { useState } from "react";
import React from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  ActivityEmptyIllustration,
  ActivityHeader,
  EmptyState,
  SegmentedTabs,
} from "@pipeline/ui";
import { useRequests } from "@/api";
import type { RequestType } from "@/api";
import { renderRequestRow } from "@/components/activity/renderRequestRow";
import { useEvmWallet, useStellarWallet, useWalletView } from "@/wallet";

// spec: docs/frontend/dashboard-components.md#transactions-route
// (responsive layout, empty-state behavior, active-chain gating, Figma refs).

/** Ordered tab definitions for the filter bar — "All" tab is intentionally absent. */
const TABS = [
  { id: "buy", label: "Buy" },
  { id: "sell", label: "Sell" },
  { id: "stake", label: "Stake" },
  { id: "unstake", label: "Unstake" },
];

/** Maps each request type to its tab id. */
const TYPE_TO_TAB: Record<RequestType, string> = {
  Deposit: "buy",
  Withdraw: "sell",
  Stake: "stake",
  Unstake: "unstake",
};

function Transactions() {
  const [activeTab, setActiveTab] = useState("buy");
  const { data, isLoading, error, refetch } = useRequests();
  // Active-chain gating (Issue #644): mirror useRequests' chain-selection logic.
  // Tech-debt: this derivation is duplicated in useRequests and RecentActivityCard;
  // extract to a shared hook in a follow-up (see tech-debt-tracker.md).
  const { kind } = useWalletView();
  const { isConnected: isEvmConnected } = useEvmWallet();
  const { isConnected: isStellarConnected } = useStellarWallet();
  const isConnected = kind === "stellar" ? isStellarConnected : isEvmConnected;

  const items = data?.requests ?? [];
  const filtered = items.filter((r) => TYPE_TO_TAB[r.type] === activeTab);

  /** True whenever the visible row count is zero (disconnected, wallet-wide empty, or tab-filter empty). */
  const shouldRenderEmpty =
    !isLoading && !error && (!isConnected || filtered.length === 0);

  return (
    <div
      data-testid="transactions-page-root"
      className="min-h-screen bg-[var(--color-pipeline-paper)] text-[color:var(--color-pipeline-ink)]"
    >
      {/* Centred content column: max-w-[480px], px-2 mobile side margins (8 px), py-8 vertical padding */}
      <main
        data-testid="transactions-main"
        className="mx-auto flex w-full max-w-[480px] flex-col gap-6 px-2 py-8"
      >
        {/* Activity header: clock icon + "Activity" heading */}
        <ActivityHeader data-testid="transactions-activity-header" />

        {/* Segmented filter bar */}
        <SegmentedTabs
          data-testid="transactions-filter-tabs"
          tabs={TABS}
          activeId={activeTab}
          onSelect={setActiveTab}
        />

        {/* Activity rows */}
        <div
          data-testid="transactions-rows-container"
          className="flex flex-col"
        >
          {isLoading && !data && (
            <div
              data-testid="transactions-loading-state"
              className="text-[color:var(--color-pipeline-ink-muted)]"
            >
              Loading…
            </div>
          )}

          {error && !data && (
            <div
              data-testid="transactions-error-state"
              className="flex flex-col gap-2"
            >
              <span className="text-[color:var(--color-pipeline-ink-muted)]">
                Couldn&apos;t load activity
              </span>
              <button
                data-testid="transactions-retry-button"
                onClick={refetch}
                className="self-start text-[color:var(--color-pipeline-ink-muted)] underline"
              >
                Retry
              </button>
            </div>
          )}

          {shouldRenderEmpty && (
            <div
              data-testid="transactions-empty-state-wrapper"
              className="flex flex-col items-center pt-8 md:min-h-[400px] md:justify-center md:pt-0"
            >
              <EmptyState
                data-testid="transactions-empty-state"
                illustration={
                  <ActivityEmptyIllustration tone="muted" width={240} />
                }
                caption="You will see all transactions here"
              />
            </div>
          )}

          {!shouldRenderEmpty &&
            filtered.length > 0 &&
            filtered.map((item, i) => (
              <React.Fragment key={i}>
                {renderRequestRow(item, kind, `transactions-row-${i}`, "pb-4")}
              </React.Fragment>
            ))}
        </div>
      </main>
    </div>
  );
}

export const Route = createFileRoute("/transactions")({
  component: Transactions,
});
