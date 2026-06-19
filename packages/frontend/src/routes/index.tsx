import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { formatUnits } from "viem";
import { Card } from "@pipeline/ui";
import { ENV } from "@/lib/env";

import {
  useEvmWallet,
  useStellarWallet,
  useWalletView,
  useConnectModal,
  useStellarDepositManagerAddresses,
  useStellarSacToken,
  useStellarStakedPlusdBalance,
  useStellarUnstakeConvertToAssets,
  SAC_DECIMALS,
  sacDisplayToRaw,
  formatUsdcDisplay,
} from "@/wallet";
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
 *   Connection state is derived from the *active wallet view namespace* (via
 *   `useWalletView().kind`), mirroring the deposit/stake convention:
 *     - kind === "stellar" → uses `useStellarWallet().isConnected`
 *     - kind === "evm" (default) → uses `useEvmWallet().isConnected`
 *   When `isConnected === false`, renders `ConnectWalletPromoCard` with an
 *   `onConnect` prop wired to `useWallet().connect()` so the home CTA opens
 *   the same AppKit modal as the header (see #224, #250).
 *   When `isConnected === true`, renders `PortfolioPlaceholderCard` — a
 *   portfolio summary card sourcing balances from the active chain (EVM via
 *   `useEvmToken`, Stellar via `useStellarSacToken` + `useStellarStakedPlusdBalance`)
 *   so a Stellar-only session sees real PLUSD/sPLUSD totals. Fixed in #688.
 *   Chart history remains a placeholder pending further wiring.
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
 * Derives a human-readable USD string from a bigint balance.
 *
 * @param value   - Raw bigint balance. Returns `"$0.00"` when `undefined` or `0n`.
 * @param decimals - Decimal precision of `value`. Defaults to `18` (EVM) to
 *                   preserve all existing call sites unchanged. Pass `SAC_DECIMALS`
 *                   (7) for Stellar balances to avoid the 18-decimal mis-scale.
 */
function formatBigintUSD(value: bigint | undefined, decimals = 18): string {
  if (value === undefined || value === 0n) return "$0.00";
  const asFloat = parseFloat(formatUnits(value, decimals));
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
  // Derive connection state from the active wallet view namespace, mirroring
  // the deposit/stake convention (see useDepositFlow, useStakeFlow).
  // This fixes #684: a Stellar-only session was incorrectly reading EVM
  // isConnected (false) and showing the "Connect wallet" screen.
  const evm = useEvmWallet();
  const stellar = useStellarWallet();
  const { kind } = useWalletView();
  const isConnected =
    kind === "stellar" ? stellar.isConnected : evm.isConnected;

  const { open: openConnectModal } = useConnectModal();
  const navigate = useNavigate();

  // ── EVM balance reads — called unconditionally (Rules of Hooks) ────────────
  // Balances are sourced from the active chain; EVM values are selected when
  // kind !== "stellar". These calls mirror the pattern in useStakeFlow.ts
  // and useDepositFlow.ts (hooks always mounted, result gated in derivation).
  // Fixed in #688: balance hooks are now chain-aware. (#684 fixed isConnected.)
  const { plusd: plusdAddress } = useStakedPlusdAsset();
  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
  const { balance: evmPlusdBalance, formattedBalance: evmPlusdFormatted } =
    useEvmToken({
      token: plusdAddress ?? ZERO_ADDRESS,
    });

  // Read the sPLUSD ERC-20 share balance for the mobile home state.
  // The sPLUSD vault IS the ERC-20 token for shares; use its address directly.
  const { balance: evmSplusdBalance } = useEvmToken({
    token: ENV.STAKED_PLUSD_ADDRESS,
  });

  // Convert EVM sPLUSD shares → PLUSD-equivalent for Total Balance (State C).
  const { data: evmSplusdInPlusd } =
    useStakedPlusdConvertToAssets(evmSplusdBalance);

  // ── Stellar balance reads — called unconditionally (Rules of Hooks) ────────
  // Mirrors TopBar.tsx lines 104-128 and useStakeFlow.ts lines 242-258.
  const { addresses: stellarAddresses } = useStellarDepositManagerAddresses();
  const stellarPlusd = useStellarSacToken({
    assetCode: "PLUSD",
    assetIssuer: stellarAddresses?.plusdAsset.issuer ?? "",
    contractId: stellarAddresses?.plusd ?? "",
  });
  const stellarSplusd = useStellarStakedPlusdBalance();

  // sPLUSD raw share balance (7-decimal bigint or undefined).
  const stellarSplusdShares = stellarSplusd.balance;

  // Convert Stellar sPLUSD shares → PLUSD-equivalent (7-decimal bigint).
  const { data: stellarSplusdInPlusd } =
    useStellarUnstakeConvertToAssets(stellarSplusdShares);

  // Stellar PLUSD raw balance: convert the Horizon decimal string to a
  // 7-decimal bigint, guarded by try/catch (mirrors useStakeFlow.ts lines 382-391).
  // No trustline → treat as undefined (same as zero / not held).
  let stellarPlusdBalance: bigint | undefined;
  if (stellarPlusd.hasTrustline && stellarPlusd.balance != null) {
    try {
      stellarPlusdBalance = sacDisplayToRaw(stellarPlusd.balance);
    } catch {
      stellarPlusdBalance = undefined;
    }
  }

  // ── Active-chain selection (after all hooks, before JSX) ──────────────────
  // Select the active chain's balance values and decimal scale.
  const isStellar = kind === "stellar";

  // Raw bigints at the active chain's scale.
  const plusdBalanceActive = isStellar ? stellarPlusdBalance : evmPlusdBalance;
  const splusdSharesActive = isStellar ? stellarSplusdShares : evmSplusdBalance;
  const splusdInPlusdActive = isStellar
    ? stellarSplusdInPlusd
    : evmSplusdInPlusd;

  // Decimal count for the active chain (used by formatBigintUSD and StakeCard).
  const activeDecimals = isStellar ? SAC_DECIMALS : 18;

  // Formatted PLUSD display string passed to StartHereCard's `mobilePlusdBalance`
  // prop. EVM: use the `formattedBalance` from useEvmToken (already "$X.XX").
  // Stellar: format the Horizon decimal string through formatUsdcDisplay
  //   (returns "$X.XX" — same shape as the EVM formatted string).
  const plusdFormattedActive: string | undefined = isStellar
    ? stellarPlusd.hasTrustline && stellarPlusd.balance != null
      ? formatUsdcDisplay(stellarPlusd.balance)
      : undefined
    : evmPlusdFormatted;

  // ── Total Balance ──────────────────────────────────────────────────────────
  // Total Balance = PLUSD balance + sPLUSD converted to PLUSD, at active scale.
  const totalBalanceBigint: bigint | undefined =
    plusdBalanceActive !== undefined || splusdInPlusdActive !== undefined
      ? (plusdBalanceActive ?? 0n) + (splusdInPlusdActive ?? 0n)
      : undefined;

  const totalBalanceFormatted = isConnected
    ? formatBigintUSD(totalBalanceBigint, activeDecimals)
    : "$0.00";

  // ── Mobile home state ──────────────────────────────────────────────────────
  // deriveMobileHomeState only compares > 0n so it is scale-agnostic.
  const mobileHomeState: MobileHomeState = isConnected
    ? deriveMobileHomeState(plusdBalanceActive, splusdSharesActive)
    : "empty";

  // Disable Stake only when connected with zero or undefined PLUSD balance.
  // When disconnected the CTA stays enabled so the user can navigate to /stake.
  const stakeDisabled =
    isConnected &&
    (plusdBalanceActive === undefined || plusdBalanceActive === 0n);

  const onBuy = () =>
    navigate({ to: "/deposit", search: { direction: "deposit" } });
  const onSell = () =>
    navigate({ to: "/deposit", search: { direction: "withdraw" } });
  const onStake = () => navigate({ to: "/stake" });

  return (
    <div
      className="min-h-screen bg-[var(--color-pipeline-paper)] text-[color:var(--color-pipeline-ink)]"
      data-testid="home-page-root"
    >
      {/* Centred main column. `py-12` (48px) gives the welcome heading air
          under the TopBar; horizontal padding lets the column breathe at
          narrower widths without ever exceeding the 1200px design cap. */}
      <main
        className="mx-auto flex w-full max-w-[1200px] flex-col gap-4 px-2 py-12 md:gap-12 md:px-8"
        data-testid="home-main"
      >
        {/* WelcomeHeader: on mobile, pass isConnected so the greeting says
            "Welcome back" for connected users and "Welcome" otherwise.
            The prop is ignored on desktop (the desktop block renders at md+). */}
        <WelcomeHeader
          isConnected={isConnected}
          data-testid="home-welcome-header"
        />

        {/* ── Mobile layout (below md): single-column stack ────────────────
            On desktop (md+) this div is hidden and the grid Card below
            takes over. On mobile we render the stacked layout directly here
            without an outer white Card wrapper (Figma frame 1989:8292 uses
            the page background, not a white card). */}
        <div
          className="flex flex-col gap-2 md:hidden"
          data-testid="home-mobile-layout"
        >
          {/* Top card: promo (disconnected) or portfolio (connected) — 256px */}
          {isConnected ? (
            <PortfolioPlaceholderCard
              className="min-h-[256px] md:min-h-[274px]"
              mobileHomeState={mobileHomeState}
              mobileTotalBalance={totalBalanceFormatted}
              data-testid="home-portfolio-placeholder"
            />
          ) : (
            <ConnectWalletPromoCard
              className="min-h-[256px] md:min-h-[274px]"
              padding="md"
              onConnect={openConnectModal}
              data-testid="home-connect-wallet-card"
            />
          )}

          {/* Balances + Stake row */}
          <div
            className="flex w-full gap-2"
            data-node-id="1989:9006"
            data-testid="home-mobile-balances-stake-row"
          >
            {/* Left: Balances stack (StartHereCard + EarnedCard) */}
            <div
              className="flex min-w-0 flex-1 flex-col gap-2"
              data-node-id="1989:9007"
              data-testid="home-mobile-balances-stack"
            >
              <StartHereCard
                className="flex-1"
                padding="sm"
                onBuy={onBuy}
                onSell={onSell}
                mobileHomeState={isConnected ? mobileHomeState : "empty"}
                mobilePlusdBalance={plusdFormattedActive}
                data-testid="home-start-here-card"
              />
              <EarnedCard
                padding="sm"
                mobileHomeState={isConnected ? mobileHomeState : undefined}
                data-testid="home-earned-card"
              />
            </div>

            {/* Right: StakeCard — fixed 189px wide, 224px tall */}
            <StakeCard
              className="min-h-[224px] md:min-h-[274px]"
              padding="sm"
              style={{ width: 189, flexShrink: 0 }}
              onStake={onStake}
              stakeDisabled={stakeDisabled}
              mobileHomeState={isConnected ? mobileHomeState : undefined}
              mobileSplusdShares={splusdSharesActive}
              mobileSplusdInPlusd={splusdInPlusdActive}
              splusdDecimals={activeDecimals}
              data-testid="home-stake-card"
            />
          </div>

          {/* RecentActivityCard — shown on mobile only in States B and C
              (connected with any balance). Per issue #466 answer Q6: if
              there is no activity the entire block is hidden on mobile. */}
          {isConnected && mobileHomeState !== "empty" && (
            <RecentActivityCard data-testid="home-recent-activity-card" />
          )}

          {/* Bottom stats strip — horizontally scrollable on mobile.
              Replaces the WelcomeHeader stats strip which is hidden on mobile. */}
          <div
            className="overflow-x-auto py-6"
            data-testid="home-mobile-stats-wrapper"
          >
            <HomeStatsStrip />
          </div>
        </div>

        {/* ── Desktop layout (md+): white Card + 7-column grid ─────────────
            Hidden on mobile; the mobile stack above takes over below md. */}
        <Card
          variant="white"
          className="hidden p-8 md:block"
          data-node-id="1497:94565"
          data-testid="home-dashboard-card"
        >
          {/* Seven-column grid mirrors Figma's `grid-cols-[repeat(7,minmax(0,1fr))]`.
              16px gap matches the design's `gap-x-16 / gap-y-16`. */}
          <div
            className="grid w-full grid-cols-7 gap-4"
            data-testid="home-dashboard-grid"
          >
            {/* Row 1, columns 1–4: Connect Wallet promo (disconnected) or
                Portfolio placeholder (connected). Both cards use
                `Card variant="yellow"` + `min-h-[274px]` so the grid does
                not reflow when the wallet state changes. */}
            {isConnected ? (
              <PortfolioPlaceholderCard
                className="col-span-4 row-start-1"
                data-testid="home-portfolio-placeholder"
              />
            ) : (
              <ConnectWalletPromoCard
                className="col-span-4 row-start-1"
                onConnect={openConnectModal}
                data-testid="home-connect-wallet-card"
              />
            )}

            {/* Rows 1–2, columns 5–7: Recent activity (full-height right
                column). `row-span-2` lets the card stretch across both rows so
                it sits flush with the bottom of the StakeCard. */}
            <RecentActivityCard
              className="col-span-3 col-start-5 row-span-2 row-start-1"
              data-testid="home-recent-activity-card"
            />

            {/* Row 2, columns 1–2: stacked StartHereCard + EarnedCard
                (Figma "Balances" frame `1497:94675`). */}
            <div
              className="col-span-2 col-start-1 row-start-2 flex flex-col gap-4"
              data-node-id="1497:94675"
              data-testid="home-balances-stack"
            >
              <StartHereCard
                className="flex-1"
                onBuy={onBuy}
                onSell={onSell}
                data-testid="home-start-here-card"
              />
              <EarnedCard data-testid="home-earned-card" />
            </div>

            {/* Row 2, columns 3–4: Stake CTA card. */}
            <StakeCard
              className="col-span-2 col-start-3 row-start-2"
              onStake={onStake}
              stakeDisabled={stakeDisabled}
              data-testid="home-stake-card"
            />

            {/* Row 3, columns 1–7: Questions & Answers strip. */}
            <div
              className="col-span-7 col-start-1 row-start-3"
              data-testid="home-qna-wrapper"
            >
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
