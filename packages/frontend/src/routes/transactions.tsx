import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  ActivityHeader,
  ActivityRow,
  AmountPill,
  SegmentedTabs,
} from "@pipeline/ui";
import { TopBar } from "@/components/TopBar";

/**
 * Transactions / Activity page — full composition (Figma `1497-94912`).
 *
 * Visual structure (top → bottom):
 *   1. `TopBar` with `activeNav="history"` and a connected wallet pill.
 *   2. Centred content column, `max-w-[480px]`, `p-8` (32 px) page padding.
 *   3. `ActivityHeader` — icon + "Activity" heading.
 *   4. `SegmentedTabs` — All / Convert / Stake / Unstake filter bar.
 *      Tab state lives in `useState`; selecting a tab updates active state
 *      but does NOT filter the list (styling-only per the Issue scope).
 *   5. Five hard-coded `ActivityRow` entries matching Figma frame `1497-94912`.
 *
 * Token discipline: this file adds no raw colors, font names, or hardcoded
 * pixel sizes. All values flow through `@pipeline/ui` component props or
 * Tailwind utilities that resolve design tokens.
 *
 * Figma reference: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1497-94912&m=dev
 */

/** Ordered tab definitions for the filter bar. */
const TABS = [
  { id: "all", label: "All" },
  { id: "convert", label: "Convert" },
  { id: "stake", label: "Stake" },
  { id: "unstake", label: "Unstake" },
];

/**
 * TwoLineAmount — right-aligned two-line amount block for stake / unstake /
 * convert / pending rows. Uses only design tokens via Tailwind utilities.
 *
 * `primary`   — top line, body size, primary ink.
 * `secondary` — bottom line, caption size, muted ink.
 */
function TwoLineAmount({
  primary,
  secondary,
}: {
  primary: string;
  secondary: string;
}) {
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span
        className={[
          "font-[family-name:var(--font-body)]",
          "text-[length:var(--text-pipeline-body)]",
          "leading-[var(--text-pipeline-body--line-height)]",
          "font-[var(--font-weight-regular)]",
          "text-[color:var(--color-pipeline-ink)]",
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

function Transactions() {
  const [activeTab, setActiveTab] = useState("all");

  return (
    <div className="min-h-screen bg-[var(--color-pipeline-paper)] text-[color:var(--color-pipeline-ink)]">
      {/* Global top bar — connected wallet state per the Issue spec */}
      <TopBar wallet={{ balance: "$10,000.00" }} activeNav="history" />

      {/* Centred content column: max-w-[480px], p-8 (32 px) padding */}
      <main className="mx-auto flex w-full max-w-[480px] flex-col gap-6 p-8">
        {/* Activity header: clock icon + "Activity" heading */}
        <ActivityHeader />

        {/* Segmented filter bar — state-driven, no list filtering */}
        <SegmentedTabs
          tabs={TABS}
          activeId={activeTab}
          onSelect={setActiveTab}
        />

        {/* Five hard-coded activity rows matching Figma frame 1497-94912 */}
        <div className="flex flex-col">
          {/* Row 1 — PLUSD → USDC, completed, AmountPill success variant */}
          <ActivityRow
            icon="check-circle"
            tone="success"
            title="PLUSD → USDC"
            timestamp="Apr 17, 2:17 PM"
            amount={<AmountPill>+500.00 USDC</AmountPill>}
          />

          {/* Row 2 — PLUSD → USDC, pending, two-line amount */}
          <ActivityRow
            icon="clock-pending"
            tone="warning"
            title="PLUSD → USDC"
            timestamp="Apr 17, 2:17 PM"
            amount={
              <TwoLineAmount primary="+1,000.00 USDC" secondary="Pending" />
            }
          />

          {/* Row 3 — Unstake, two-line (+1,000.00 PLUSD / −1,000.00 sPLUSD) */}
          <ActivityRow
            icon="arrow-up-circle"
            title="Unstake"
            timestamp="Apr 17, 2:20 PM"
            amount={
              <TwoLineAmount
                primary="+1,000.00 PLUSD"
                secondary="−1,000.00 sPLUSD"
              />
            }
          />

          {/* Row 4 — Stake, two-line (−1,000.00 PLUSD / +1,000.00 sPLUSD) */}
          <ActivityRow
            icon="arrow-down-circle"
            title="Stake"
            timestamp="Apr 17, 2:15 PM"
            amount={
              <TwoLineAmount
                primary="−1,000.00 PLUSD"
                secondary="+1,000.00 sPLUSD"
              />
            }
          />

          {/* Row 5 — USDC → PLUSD, two-line (+1,000.00 PLUSD / −1,000.00 USDC) */}
          <ActivityRow
            icon="exchange"
            title="USDC → PLUSD"
            timestamp="Apr 17, 2:12 PM"
            amount={
              <TwoLineAmount
                primary="+1,000.00 PLUSD"
                secondary="−1,000.00 USDC"
              />
            }
          />
        </div>
      </main>
    </div>
  );
}

export const Route = createFileRoute("/transactions")({
  component: Transactions,
});
