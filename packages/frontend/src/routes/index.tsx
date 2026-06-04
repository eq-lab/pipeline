import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { formatUnits } from "viem";
import { Card } from "@pipeline/ui";
import { ENV } from "@/lib/env";

import { useEvmWallet } from "@/wallet/evm/useEvmWallet";
import {
  useStakedPlusdAsset,
  useStakedPlusdConvertToAssets,
} from "@/wallet/evm/useStakedPlusd";
import { useEvmToken } from "@/wallet/evm/useEvmToken";
import { WelcomeHeader } from "@/components/WelcomeHeader";
import { HomeStatsStrip } from "@/components/HomeStatsStrip";
import { ConnectWalletPromoCard } from "@/components/ConnectWalletPromoCard";
import { PortfolioPlaceholderCard } from "@/components/PortfolioPlaceholderCard";
import { StartHereCard } from "@/components/StartHereCard";
import { StakeCard } from "@/components/StakeCard";
import { EarnedCard } from "@/components/EarnedCard";
import { RecentActivityCard } from "@/components/RecentActivityCard";
import { QnaSection } from "@/components/QnaSection";

/**
 * Home page — full composition (Figma `1497:94556` desktop, `1989:8292` mobile).
 *
 * ## Desktop (md+) visual structure — top → bottom:
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
 *
 * ## Mobile (below md) visual structure — single-column stack:
 *   1. `WelcomeHeader` — title only (32px), stats strip hidden.
 *   2. `ConnectWalletPromoCard` / `PortfolioPlaceholderCard` — full width, 256px tall.
 *   3. A flex row: left = `StartHereCard` + `EarnedCard` stacked (flex-1);
 *      right = `StakeCard` (fixed 189px wide, 224px tall).
 *   4. `RecentActivityCard` — shown in the connected state on mobile.
 *   5. Stats strip (`HomeStatsStrip`) — horizontally scrollable, at the bottom.
 *   6. `QnaSection` and desktop `RecentActivityCard` column — hidden on mobile.
 *
 * ## Top-left card branching:
 *   When `isConnected === false`, renders `ConnectWalletPromoCard` with an
 *   `onConnect` prop wired to `useWallet().connect()` so the home CTA opens
 *   the same AppKit modal as the header (see #224, #250).
 *   When `isConnected === true`, renders `PortfolioPlaceholderCard` — a static
 *   connected-state placeholder ($0.00, segmented tabs, chart silhouette)
 *   that keeps the grid from reflowing while real data wiring is deferred.
 *
 * Token discipline: this composer adds no raw colors, fonts, sizes or radii.
 * Every value comes from `@pipeline/ui/styles/theme.css` via component
 * primitives or Tailwind utilities that resolve theme tokens.
 *
 * Responsive behaviour: below md (768px) the layout becomes a single-column
 * stack matching Figma mobile frame `1989:8292`. The 7-column desktop grid is
 * preserved at md+ via `md:grid` and `md:grid-cols-7`.
 */

/**
 * Derives a human-readable USD string from a bigint balance at 18-decimal
 * precision. Returns `"$0.00"` when the value is `undefined` or `0n`.
 */
function formatBigintUSD(value: bigint | undefined): string {
  if (value === undefined || value === 0n) return "$0.00";
  const asFloat = parseFloat(formatUnits(value, 18));
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(asFloat);
}

/**
 * Connected-wallet balance state selector for the mobile home page.
 *
 *   "splusd" — wallet has sPLUSD shares (State C, Figma `1886:46777`)
 *   "plusd"  — wallet has PLUSD but no sPLUSD (State B, Figma `1984:6501`)
 *   "empty"  — connected but zero balances (State A, Figma `1988:7074`)
 *
 * Only meaningful when `isConnected === true`; callers should short-circuit
 * to the disconnected layout otherwise.
 */
type MobileHomeState = "empty" | "plusd" | "splusd";

function deriveMobileHomeState(
  plusdBalance: bigint | undefined,
  splusdBalance: bigint | undefined,
): MobileHomeState {
  if (splusdBalance !== undefined && splusdBalance > 0n) return "splusd";
  if (plusdBalance !== undefined && plusdBalance > 0n) return "plusd";
  return "empty";
}

function Home() {
  const { isConnected, connect } = useEvmWallet();
  const navigate = useNavigate();

  // Read the connected wallet's PLUSD balance to gate the Stake CTA.
  const { plusd: plusdAddress } = useStakedPlusdAsset();
  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
  const { balance: plusdBalance, formattedBalance: plusdFormatted } =
    useEvmToken({
      token: plusdAddress ?? ZERO_ADDRESS,
    });

  // Read the sPLUSD ERC-20 share balance for the mobile home state.
  // The sPLUSD vault IS the ERC-20 token for shares; use its address directly.
  const { balance: splusdBalance } = useEvmToken({
    token: ENV.STAKED_PLUSD_ADDRESS,
  });

  // Convert sPLUSD shares → PLUSD-equivalent for Total Balance (State C).
  const { data: splusdInPlusd } = useStakedPlusdConvertToAssets(splusdBalance);

  // Total Balance = PLUSD balance + sPLUSD converted to PLUSD.
  const totalBalanceBigint: bigint | undefined =
    plusdBalance !== undefined || splusdInPlusd !== undefined
      ? (plusdBalance ?? 0n) + (splusdInPlusd ?? 0n)
      : undefined;

  const totalBalanceFormatted = isConnected
    ? formatBigintUSD(totalBalanceBigint)
    : "$0.00";

  // Derive mobile home state (only when connected).
  const mobileHomeState: MobileHomeState = isConnected
    ? deriveMobileHomeState(plusdBalance, splusdBalance)
    : "empty";

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
      <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-4 px-2 py-12 md:gap-12 md:px-8">
        {/* WelcomeHeader: on mobile, pass isConnected so the greeting says
            "Welcome back" for connected users and "Welcome" otherwise.
            The prop is ignored on desktop (the desktop block renders at md+). */}
        <WelcomeHeader isConnected={isConnected} />

        {/* ── Mobile layout (below md): single-column stack ────────────────
            On desktop (md+) this div is hidden and the grid Card below
            takes over. On mobile we render the stacked layout directly here
            without an outer white Card wrapper (Figma frame 1989:8292 uses
            the page background, not a white card). */}
        <div className="flex flex-col gap-2 md:hidden">
          {/* Top card: promo (disconnected) or portfolio (connected) — 256px */}
          {isConnected ? (
            <PortfolioPlaceholderCard
              className="min-h-[256px] md:min-h-[274px]"
              mobileHomeState={mobileHomeState}
              mobileTotalBalance={totalBalanceFormatted}
            />
          ) : (
            <ConnectWalletPromoCard
              className="min-h-[256px] md:min-h-[274px]"
              padding="md"
              onConnect={connect}
            />
          )}

          {/* Balances + Stake row */}
          <div className="flex w-full gap-2" data-node-id="1989:9006">
            {/* Left: Balances stack (StartHereCard + EarnedCard) */}
            <div
              className="flex min-w-0 flex-1 flex-col gap-2"
              data-node-id="1989:9007"
            >
              <StartHereCard
                className="flex-1"
                padding="sm"
                onBuy={onBuy}
                onSell={onSell}
                mobileHomeState={isConnected ? mobileHomeState : "empty"}
                mobilePlusdBalance={plusdFormatted}
              />
              <EarnedCard padding="sm" mobileHomeState={isConnected ? mobileHomeState : undefined} />
            </div>

            {/* Right: StakeCard — fixed 189px wide, 224px tall */}
            <StakeCard
              className="min-h-[224px] md:min-h-[274px]"
              padding="sm"
              style={{ width: 189, flexShrink: 0 }}
              onStake={onStake}
              stakeDisabled={stakeDisabled}
              mobileHomeState={isConnected ? mobileHomeState : undefined}
              mobileSplusdShares={splusdBalance}
              mobileSplusdInPlusd={splusdInPlusd}
            />
          </div>

          {/* RecentActivityCard — shown on mobile only in States B and C
              (connected with any balance). Per issue #466 answer Q6: if
              there is no activity the entire block is hidden on mobile. */}
          {isConnected && mobileHomeState !== "empty" && (
            <RecentActivityCard />
          )}

          {/* Bottom stats strip — horizontally scrollable on mobile.
              Replaces the WelcomeHeader stats strip which is hidden on mobile. */}
          <div className="overflow-x-auto py-6">
            <HomeStatsStrip />
          </div>
        </div>

        {/* ── Desktop layout (md+): white Card + 7-column grid ─────────────
            Hidden on mobile; the mobile stack above takes over below md. */}
        <Card
          variant="white"
          className="hidden p-8 md:block"
          data-node-id="1497:94565"
        >
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
