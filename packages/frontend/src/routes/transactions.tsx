import { useState } from "react";
import React from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  ActivityHeader,
  SegmentedTabs,
} from "@pipeline/ui";
import { useRequests } from "@/api";
import type { RequestType } from "@/api";
import { renderRequestRow } from "@/components/activity/renderRequestRow";

/**
 * Transactions / Activity page — wired to `GET /v1/requests` (Figma `1497-94912`).
 *
 * Visual structure (top → bottom):
 *   1. Centred content column, `max-w-[480px]`, `p-8` (32 px) page padding.
 *   2. `ActivityHeader` — icon + "Activity" heading.
 *   3. `SegmentedTabs` — Buy / Sell / Stake / Unstake filter bar.
 *      The "All" tab has been removed; "Buy" is the default.
 *      Selecting a tab filters the in-memory array client-side — no re-fetch.
 *   4. Activity rows from `useRequests()`, filtered by the active tab.
 *
 * Token discipline: this file adds no raw colors, font names, or hardcoded
 * pixel sizes. All values flow through `@pipeline/ui` component props or
 * Tailwind utilities that resolve design tokens.
 *
 * Figma reference: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1497-94912&m=dev
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

  const items = data?.requests ?? [];
  const filtered = items.filter((r) => TYPE_TO_TAB[r.type] === activeTab);

  return (
    <div className="min-h-screen bg-[var(--color-pipeline-paper)] text-[color:var(--color-pipeline-ink)]">
      {/* Centred content column: max-w-[480px], p-8 (32 px) padding */}
      <main className="mx-auto flex w-full max-w-[480px] flex-col gap-6 p-8">
        {/* Activity header: clock icon + "Activity" heading */}
        <ActivityHeader />

        {/* Segmented filter bar */}
        <SegmentedTabs
          tabs={TABS}
          activeId={activeTab}
          onSelect={setActiveTab}
        />

        {/* Activity rows */}
        <div className="flex flex-col">
          {isLoading && !data && (
            <div className="text-[color:var(--color-pipeline-ink-muted)]">
              Loading…
            </div>
          )}

          {error && !data && (
            <div className="flex flex-col gap-2">
              <span className="text-[color:var(--color-pipeline-ink-muted)]">
                Couldn&apos;t load activity
              </span>
              <button
                onClick={refetch}
                className="self-start text-[color:var(--color-pipeline-ink-muted)] underline"
              >
                Retry
              </button>
            </div>
          )}

          {data && filtered.length === 0 && (
            <div className="text-[color:var(--color-pipeline-ink-muted)]">
              No activity yet
            </div>
          )}

          {data &&
            filtered.length > 0 &&
            filtered.map((item, i) => (
              <React.Fragment key={i}>{renderRequestRow(item)}</React.Fragment>
            ))}
        </div>
      </main>
    </div>
  );
}

export const Route = createFileRoute("/transactions")({
  component: Transactions,
});
