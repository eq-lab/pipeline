import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Card } from "@pipeline/ui";

import { useEvmWallet } from "@/wallet/evm/useEvmWallet";
import { useStakedPlusdAsset } from "@/wallet/evm/useStakedPlusd";
import { useEvmToken } from "@/wallet/evm/useEvmToken";
import { WelcomeHeader } from "@/components/WelcomeHeader";
import { ConnectWalletPromoCard } from "@/components/ConnectWalletPromoCard";
import { PortfolioPlaceholderCard } from "@/components/PortfolioPlaceholderCard";
import { StartHereCard } from "@/components/StartHereCard";
import { StakeCard } from "@/components/StakeCard";
import { EarnedCard } from "@/components/EarnedCard";
import { RecentActivityCard } from "@/components/RecentActivityCard";
import { QnaSection } from "@/components/QnaSection";

/**
 * Home page — full composition (Figma `1497:94556`).
 *
 * Visual structure (top → bottom):
 *   1. Sticky `TopBar` along the top edge of the viewport.
 *   2. A centred content column (`max-w-[1200px]`) with `py-32` breathing room
 *      under the bar. The column stacks the `WelcomeHeader` and a white outer
 *      `Card` with a 48px gap.
 *   3. Inside the outer card, a 7-column CSS grid lays out the dashboard:
 *        ┌────────────────────────────────┬──────────────────────┐
 *        │ Portfolio (top-left slot)      │ Recent activity      │
 *        │  col 1-4, row 1                │  col 5-7, row 1-2    │
 *        │  • Disconnected: ConnectWallet │                      │
 *        │    PromoCard + onConnect hook  │                      │
 *        │  • Connected: Portfolio        │                      │
 *        │    PlaceholderCard ($0.00)     │                      │
 *        ├──────────────┬─────────────────┤                      │
 *        │ Balances     │ StakeCard       │                      │
 *        │  col 1-2     │  col 3-4        │                      │
 *        │  row 2       │  row 2          │                      │
 *        └──────────────┴─────────────────┴──────────────────────┘
 *        │ QnaSection — col 1-7, row 3                           │
 *        └───────────────────────────────────────────────────────┘
 *      The "Balances" column itself is a vertical stack of
 *      `StartHereCard` + `EarnedCard` (Figma node `1497:94675`).
 *      `StartHereCard` receives `onBuy` (→ `/deposit`) and `onSell`
 *      (→ `/deposit?direction=withdraw`); `StakeCard` receives `onStake`
 *      (→ `/stake`) — all three wired via `useNavigate()`.
 *
 *  Top-left card branching:
 *    When `isConnected === false`, renders `ConnectWalletPromoCard` with an
 *    `onConnect` prop wired to `useWallet().connect()` so the home CTA opens
 *    the same AppKit modal as the header (see #224, #250).
 *    When `isConnected === true`, renders `PortfolioPlaceholderCard` — a static
 *    connected-state placeholder ($0.00, segmented tabs, chart silhouette)
 *    that keeps the grid from reflowing while real data wiring is deferred.
 *
 * Token discipline: this composer adds no raw colors, fonts, sizes or radii.
 * Every value comes from `@pipeline/ui/styles/theme.css` via component
 * primitives or Tailwind utilities that resolve theme tokens.
 *
 * Responsive behaviour: the outer column is capped at 1200px so the layout
 * stays stable from the 1728px Figma design width down through common laptop
 * widths (1680 / 1440 / 1280). The 7-column grid uses `minmax(0, 1fr)` so the
 * columns share remaining space evenly and cards never overflow their tracks.
 */

function Home() {
  const { isConnected, connect } = useEvmWallet();
  const navigate = useNavigate();

  // Read the connected wallet's PLUSD balance to gate the Stake CTA.
  const { plusd: plusdAddress } = useStakedPlusdAsset();
  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
  const { balance: plusdBalance } = useEvmToken({
    token: plusdAddress ?? ZERO_ADDRESS,
  });
  // Disable Stake only when connected with zero or undefined PLUSD balance.
  // When disconnected the CTA stays enabled so the user can navigate to /stake.
  const stakeDisabled =
    isConnected && (plusdBalance === undefined || plusdBalance === 0n);

  const onBuy = () =>
    navigate({ to: "/deposit", search: { direction: "deposit" } });
  const onSell = () =>
    navigate({ to: "/deposit", search: { direction: "withdraw" } });
  const onStake = () => navigate({ to: "/stake" });

  return (
    <div className="min-h-screen bg-[var(--color-pipeline-paper)] text-[color:var(--color-pipeline-ink)]">
      {/* Centred main column. `py-12` (48px) gives the welcome heading air
          under the TopBar; horizontal padding lets the column breathe at
          narrower widths without ever exceeding the 1200px design cap. */}
      <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-12 px-8 py-12">
        <WelcomeHeader />

        {/* Outer white Card — Figma node `1497:94565`. The Card primitive owns
            its surface/border/radius tokens; we override the default 24px
            interior padding with `p-8` (32px) to mirror the design. */}
        <Card variant="white" className="p-8" data-node-id="1497:94565">
          {/* Seven-column grid mirrors Figma's `grid-cols-[repeat(7,minmax(0,1fr))]`.
              16px gap matches the design's `gap-x-16 / gap-y-16`. */}
          <div className="grid w-full grid-cols-7 gap-4">
            {/* Row 1, columns 1–4: Connect Wallet promo (disconnected) or
                Portfolio placeholder (connected). Both cards use
                `Card variant="yellow"` + `min-h-[274px]` so the grid does
                not reflow when the wallet state changes. */}
            {isConnected ? (
              <PortfolioPlaceholderCard className="col-span-4 row-start-1" />
            ) : (
              <ConnectWalletPromoCard
                className="col-span-4 row-start-1"
                onConnect={connect}
              />
            )}

            {/* Rows 1–2, columns 5–7: Recent activity (full-height right
                column). `row-span-2` lets the card stretch across both rows so
                it sits flush with the bottom of the StakeCard. */}
            <RecentActivityCard className="col-span-3 col-start-5 row-span-2 row-start-1" />

            {/* Row 2, columns 1–2: stacked StartHereCard + EarnedCard
                (Figma "Balances" frame `1497:94675`). */}
            <div
              className="col-span-2 col-start-1 row-start-2 flex flex-col gap-4"
              data-node-id="1497:94675"
            >
              <StartHereCard className="flex-1" onBuy={onBuy} onSell={onSell} />
              <EarnedCard />
            </div>

            {/* Row 2, columns 3–4: Stake CTA card. */}
            <StakeCard
              className="col-span-2 col-start-3 row-start-2"
              onStake={onStake}
              stakeDisabled={stakeDisabled}
            />

            {/* Row 3, columns 1–7: Questions & Answers strip. */}
            <div className="col-span-7 col-start-1 row-start-3">
              <QnaSection />
            </div>
          </div>
        </Card>
      </main>
    </div>
  );
}

export const Route = createFileRoute("/")({
  component: Home,
});
