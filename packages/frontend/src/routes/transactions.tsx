import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  ActivityHeader,
  ActivityRow,
  AmountPill,
  SegmentedTabs,
} from "@pipeline/ui";
import { useRequests } from "@/api";
import type { RequestItem, RequestType } from "@/api";
import { formatTokenAmount, formatActivityTime } from "@/lib/format";

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

/**
 * TwoLineAmount — right-aligned two-line amount block for stake / unstake /
 * pending rows. Uses only design tokens via Tailwind utilities.
 *
 * `primary`   — top line, body size.
 * `secondary` — bottom line, caption size, always muted ink.
 * `tone`      — `"default"` renders the top line in primary ink (completed
 *               rows); `"muted"` renders both lines in muted ink (pending
 *               rows, communicating non-final state). Defaults to `"default"`.
 */
function TwoLineAmount({
  primary,
  secondary,
  tone = "default",
}: {
  primary: string;
  secondary: string;
  tone?: "default" | "muted";
}) {
  const primaryColor =
    tone === "muted"
      ? "text-[color:var(--color-pipeline-ink-muted)]"
      : "text-[color:var(--color-pipeline-ink)]";

  return (
    <div className="flex flex-col items-end gap-0.5">
      <span
        className={[
          "font-[family-name:var(--font-body)]",
          "text-[length:var(--text-pipeline-body)]",
          "leading-[var(--text-pipeline-body--line-height)]",
          "font-[var(--font-weight-regular)]",
          primaryColor,
          "whitespace-nowrap",
        ].join(" ")}
      >
        {primary}
      </span>
      <span
        className={[
          "font-[family-name:var(--font-body)]",
          "text-[length:var(--text-pipeline-caption)]",
          "leading-[var(--text-pipeline-caption--line-height)]",
          "font-[var(--font-weight-regular)]",
          "text-[color:var(--color-pipeline-ink-muted)]",
          "whitespace-nowrap",
        ].join(" ")}
      >
        {secondary}
      </span>
    </div>
  );
}

/** Renders a single `RequestItem` as an `<ActivityRow>`. */
function RequestRow({ item }: { item: RequestItem }) {
  const timestamp = formatActivityTime(item.created_at);

  if (item.type === "Deposit") {
    const amount = formatTokenAmount(item.amount, 6);
    if (item.status === "Completed") {
      return (
        <ActivityRow
          icon="check-circle"
          tone="success"
          title="Buy"
          timestamp={timestamp}
          amount={<AmountPill>+{amount} USDC</AmountPill>}
        />
      );
    }
    const secondary =
      item.status === "VerificationFailed" ? "Verification failed" : "Pending";
    return (
      <ActivityRow
        icon="clock-pending"
        tone="warning"
        title="Buy"
        timestamp={timestamp}
        amount={
          <TwoLineAmount
            primary={`+${amount} USDC`}
            secondary={secondary}
            tone="muted"
          />
        }
      />
    );
  }

  if (item.type === "Withdraw") {
    const amount = formatTokenAmount(item.amount, 6);
    if (item.status === "Completed") {
      return (
        <ActivityRow
          icon="check-circle"
          tone="success"
          title="Sell"
          timestamp={timestamp}
          amount={<AmountPill>−{amount} USDC</AmountPill>}
        />
      );
    }
    const secondary =
      item.status === "VerificationFailed" ? "Verification failed" : "Pending";
    return (
      <ActivityRow
        icon="clock-pending"
        tone="warning"
        title="Sell"
        timestamp={timestamp}
        amount={
          <TwoLineAmount
            primary={`−${amount} USDC`}
            secondary={secondary}
            tone="muted"
          />
        }
      />
    );
  }

  if (item.type === "Stake") {
    const assets = formatTokenAmount(item.assets ?? item.amount, 18);
    const shares = formatTokenAmount(item.shares ?? "0", 18);
    return (
      <ActivityRow
        icon="arrow-down-circle"
        title="Stake"
        timestamp={timestamp}
        amount={
          <TwoLineAmount
            primary={`−${assets} PLUSD`}
            secondary={`+${shares} sPLUSD`}
          />
        }
      />
    );
  }

  // Unstake
  const assets = formatTokenAmount(item.assets ?? item.amount, 18);
  const shares = formatTokenAmount(item.shares ?? "0", 18);
  return (
    <ActivityRow
      icon="arrow-up-circle"
      title="Unstake"
      timestamp={timestamp}
      amount={
        <TwoLineAmount
          primary={`+${assets} PLUSD`}
          secondary={`−${shares} sPLUSD`}
        />
      }
    />
  );
}

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
            filtered.map((item, i) => <RequestRow key={i} item={item} />)}
        </div>
      </main>
    </div>
  );
}

export const Route = createFileRoute("/transactions")({
  component: Transactions,
});
