import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Card,
  InfoRow,
  SegmentedTabs,
  StakeHeader,
  StepsCard,
  TokenAmountDisplay,
  TokenInput,
} from "@pipeline/ui";

/**
 * Stake route — full page composition.
 *
 * Layout matches Figma node 1497-95311:
 *   1. Sticky `TopBar` with connected-wallet state and active stats nav.
 *   2. Centred narrow column (max-w-lg) stacking:
 *      - `StakeHeader` with "Earn 8.42% p.a." title
 *      - Input card: `SegmentedTabs` (Stake/Unstake) + `TokenInput` (PLUSD)
 *      - Output card: `TokenAmountDisplay` (sPLUSD) + two `InfoRow` items
 *      - `StepsCard` with two disabled steps (Approve + Stake)
 *
 * Token discipline: no raw colors, fonts, sizes, or radii. Everything goes
 * through design tokens or component primitives from `@pipeline/ui`.
 *
 * Tab state is local `useState`; selecting a tab visibly updates the active
 * segment but does NOT alter the input below (styling only).
 *
 * Figma reference: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1497-95311&m=dev
 */
function Stake() {
  const [activeTab, setActiveTab] = useState<string>("stake");

  return (
    <div className="min-h-screen bg-[var(--color-pipeline-paper)] text-[color:var(--color-pipeline-ink)]">
      {/* Centred narrow column — mirrors Figma's centred single-column layout
          for the stake screen. py-12 gives breathing room under the TopBar;
          gap-6 (24px) matches the vertical spacing between sections. */}
      <main className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-12">
        {/* Section header: chart hero icon + "Earn 8.42% p.a." heading */}
        <StakeHeader title="Earn 8.42% p.a." />

        {/* Input card: tab switcher + PLUSD token input */}
        <Card variant="white" className="flex flex-col gap-4">
          {/* Stake / Unstake segmented control */}
          <SegmentedTabs
            tabs={[
              { id: "stake", label: "Stake" },
              { id: "unstake", label: "Unstake" },
            ]}
            activeId={activeTab}
            onSelect={setActiveTab}
          />

          {/* PLUSD amount entry with quick-amount chips */}
          <TokenInput
            token="plusd"
            tokenLabel="PLUSD"
            balanceLabel="1,000.00"
            placeholderValue="0"
            quickAmounts={[
              { label: "25%" },
              { label: "50%" },
              { label: "75%" },
              { label: "Max" },
            ]}
          />
        </Card>

        {/* Output card: sPLUSD amount display + exchange rate + network fee */}
        <Card variant="white" className="flex flex-col gap-4">
          <TokenAmountDisplay
            token="splusd"
            tokenLabel="sPLUSD"
            balanceLabel="0.00"
            value="0"
          />
          <InfoRow label="Exchange rate" value="1 PLUSD = 0.9596 sPLUSD" />
          <InfoRow label="Network fee" value="~$1.20" />
        </Card>

        {/* Steps card: two disabled on-chain steps — Approve then Stake */}
        <StepsCard
          steps={[
            {
              label: "Allow contract to use PLUSD",
              actionLabel: "Approve",
              disabled: true,
            },
            {
              label: "Confirm and stake PLUSD",
              actionLabel: "Stake",
              disabled: true,
            },
          ]}
        />
      </main>
    </div>
  );
}

export const Route = createFileRoute("/stake")({
  component: Stake,
});
