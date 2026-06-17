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
import { useEvmWallet } from "@/wallet";

/**
 * Transactions / Activity page — wired to `GET /v1/requests`.
 *
 * Responsive layout:
 *   - Mobile (< 768 px) — Figma node 1993-9592 (402×874):
 *     8 px side margins (`px-2`); `ActivityHeader` shows left-aligned heading
 *     with no arrow-clock icon.
 *   - Desktop (≥ 768 px) — Figma node 1497-94912:
 *     centred content column capped at `max-w-[480px]`; `ActivityHeader`
 *     shows centred icon + heading.
 *
 * Visual structure (top → bottom):
 *   1. Centred content column, `max-w-[480px]`, `px-2 py-8` page padding.
 *   2. `ActivityHeader` — responsive (icon + centred heading on desktop;
 *      no icon, left-aligned heading on mobile).
 *   3. `SegmentedTabs` — Buy / Sell / Stake / Unstake filter bar.
 *      The "All" tab has been removed; "Buy" is the default.
 *      Selecting a tab filters the in-memory array client-side — no re-fetch.
 *   4. Activity rows from `useRequests()`, filtered by the active tab.
 *
 * Empty-state behaviour: the full `EmptyState` illustration + caption renders
 * whenever the visible row count is zero — whether the wallet is disconnected,
 * the API returned zero rows, or the active tab filter yields zero rows. The
 * intent is a single consistent visual rather than a different treatment per
 * cause (a deliberate reversal of part of #257).
 *
 * Token discipline: this file adds no raw colors, font names, or hardcoded
 * pixel sizes. All values flow through `@pipeline/ui` component props or
 * Tailwind utilities that resolve design tokens.
 *
 * Empty-state layout:
 *   - Mobile (< 768 px) — Figma node 1993-9958: illustration (240×240) and
 *     caption are top-anchored just below the tab bar with natural spacing;
 *     no tall centering wrapper.
 *   - Desktop (≥ 768 px) — Figma node 1497-94912: illustration is
 *     vertically centred inside a `min-h-[400px]` wrapper.
 *   The wrapper uses responsive utilities (`md:min-h-[400px] md:justify-center`)
 *   to gate the desktop centering treatment without affecting mobile.
 *
 * Figma references:
 *   Desktop: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1497-94912&m=dev
 *   Mobile (with data): https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1993-9592&m=dev
 *   Mobile (empty):     https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1993-9958&m=dev
 */

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
  const { isConnected } = useEvmWallet();

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

          {filtered.length > 0 &&
            filtered.map((item, i) => (
              <React.Fragment key={i}>
                {renderRequestRow(item, `transactions-row-${i}`)}
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
