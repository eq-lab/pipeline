import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Card } from "@pipeline/ui";
import { ENV } from "@/lib/env";
import {
  formatBigintCurrency,
  formatRawDecimalUSD,
  isDisplayZero,
} from "@/lib/format";

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
import { usePnl, usePositionsHistory } from "@/api";
import { DEFAULT_PERIOD_ID, buildSeries } from "@/components/usePortfolioChart";

// spec: docs/frontend/dashboard-components.md#home-route
// (desktop/mobile composition, top-left card branching, Figma refs).

type MobileHomeState = "empty" | "plusd" | "splusd";

function deriveMobileHomeState(
  plusdBalance: bigint | undefined,
  splusdBalance: bigint | undefined,
  decimals: number,
): MobileHomeState {
  if (!isDisplayZero(splusdBalance, decimals)) return "splusd";
  if (!isDisplayZero(plusdBalance, decimals)) return "plusd";
  return "empty";
}

function Home() {
  const evm = useEvmWallet();
  const stellar = useStellarWallet();
  const { kind } = useWalletView();
  const isConnected =
    kind === "stellar" ? stellar.isConnected : evm.isConnected;
  const pnl = usePnl();
  const [portfolioPeriodId, setPortfolioPeriodId] = useState(DEFAULT_PERIOD_ID);
  const positionsHistory = usePositionsHistory(portfolioPeriodId);

  const { open: openConnectModal } = useConnectModal();
  const navigate = useNavigate();

  const { plusd: plusdAddress } = useStakedPlusdAsset();
  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
  const { balance: evmPlusdBalance, formattedBalance: evmPlusdFormatted } =
    useEvmToken({
      token: plusdAddress ?? ZERO_ADDRESS,
    });

  const { balance: evmSplusdBalance } = useEvmToken({
    token: ENV.STAKED_PLUSD_ADDRESS,
  });

  const { data: evmSplusdInPlusd } =
    useStakedPlusdConvertToAssets(evmSplusdBalance);

  const { addresses: stellarAddresses } = useStellarDepositManagerAddresses();
  const stellarPlusd = useStellarSacToken({
    assetCode: "PLUSD",
    assetIssuer: stellarAddresses?.plusdAsset.issuer ?? "",
    contractId: stellarAddresses?.plusd ?? "",
  });
  const stellarSplusd = useStellarStakedPlusdBalance();

  const stellarSplusdShares = stellarSplusd.balance;

  const { data: stellarSplusdInPlusd } =
    useStellarUnstakeConvertToAssets(stellarSplusdShares);

  let stellarPlusdBalance: bigint | undefined;
  if (stellarPlusd.hasTrustline && stellarPlusd.balance != null) {
    try {
      stellarPlusdBalance = sacDisplayToRaw(stellarPlusd.balance);
    } catch {
      stellarPlusdBalance = undefined;
    }
  }

  const isStellar = kind === "stellar";

  const plusdBalanceActive = isStellar ? stellarPlusdBalance : evmPlusdBalance;
  const splusdSharesActive = isStellar ? stellarSplusdShares : evmSplusdBalance;
  const splusdInPlusdActive = isStellar
    ? stellarSplusdInPlusd
    : evmSplusdInPlusd;

  const activeDecimals = isStellar ? SAC_DECIMALS : 18;

  const plusdFormattedActive: string | undefined = isStellar
    ? stellarPlusd.hasTrustline && stellarPlusd.balance != null
      ? formatUsdcDisplay(stellarPlusd.balance)
      : undefined
    : evmPlusdFormatted;

  const splusdBalanceFormatted = formatBigintCurrency(
    splusdSharesActive,
    activeDecimals,
  );
  const unrealizedPnlFormatted = formatRawDecimalUSD(
    pnl.data?.total_unrealized_pnl,
    activeDecimals,
    { signed: true, suffix: "unrealized" },
  );

  const portfolioSeries = buildSeries(
    positionsHistory.data?.history,
    activeDecimals,
  );

  const mobileHomeState: MobileHomeState = isConnected
    ? deriveMobileHomeState(
        plusdBalanceActive,
        splusdSharesActive,
        activeDecimals,
      )
    : "empty";

  const earnedPnlLabel =
    mobileHomeState === "splusd" && pnl.data?.total_pnl != null
      ? formatRawDecimalUSD(pnl.data.total_pnl, activeDecimals, {
          signed: true,
        })
      : undefined;

  const stakeDisabled =
    isConnected && isDisplayZero(plusdBalanceActive, activeDecimals);

  const sellDisabled =
    !isConnected || isDisplayZero(plusdBalanceActive, activeDecimals);

  const onBuy = () => {
    if (!isConnected) {
      openConnectModal();
      return;
    }
    navigate({ to: "/deposit", search: { direction: "deposit" } });
  };
  const onSell = () => {
    if (!isConnected) {
      openConnectModal();
      return;
    }
    navigate({ to: "/deposit", search: { direction: "withdraw" } });
  };
  const onStake = () => {
    if (!isConnected) {
      openConnectModal();
      return;
    }
    navigate({ to: "/stake", search: { tab: "stake" } });
  };
  const onUnstake = () =>
    navigate({ to: "/stake", search: { tab: "unstake" } });

  return (
    <div
      className="min-h-screen bg-[var(--color-pipeline-paper)] text-[color:var(--color-pipeline-ink)]"
      data-testid="home-page-root"
    >
      <main
        className="mx-auto flex w-full max-w-[1200px] flex-col gap-4 px-2 py-12 md:gap-12 md:px-8"
        data-testid="home-main"
      >
        <WelcomeHeader
          isConnected={isConnected}
          data-testid="home-welcome-header"
        />

        <div
          className="flex flex-col gap-2 md:hidden"
          data-testid="home-mobile-layout"
        >
          {isConnected ? (
            <PortfolioPlaceholderCard
              className="min-h-[256px] md:min-h-[274px]"
              mobileHomeState={mobileHomeState}
              balanceLabel={splusdBalanceFormatted}
              unrealizedPnlLabel={unrealizedPnlFormatted}
              activePeriodId={portfolioPeriodId}
              onActivePeriodChange={setPortfolioPeriodId}
              series={portfolioSeries}
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

          <div
            className="flex w-full gap-2"
            data-node-id="1989:9006"
            data-testid="home-mobile-balances-stake-row"
          >
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
                sellDisabled={sellDisabled}
                mobileHomeState={isConnected ? mobileHomeState : "empty"}
                mobilePlusdBalance={plusdFormattedActive}
                data-testid="home-start-here-card"
              />
              <EarnedCard
                padding="sm"
                earnedPnlLabel={earnedPnlLabel}
                data-testid="home-earned-card"
              />
            </div>

            <StakeCard
              className="min-h-[224px] md:min-h-[274px]"
              padding="sm"
              style={{ width: 189, flexShrink: 0 }}
              onStake={onStake}
              onUnstake={onUnstake}
              stakeDisabled={stakeDisabled}
              mobileHomeState={isConnected ? mobileHomeState : undefined}
              mobileSplusdShares={splusdSharesActive}
              mobileSplusdInPlusd={splusdInPlusdActive}
              splusdUsdValue={splusdBalanceFormatted}
              splusdDecimals={activeDecimals}
              data-testid="home-stake-card"
            />
          </div>

          {isConnected && mobileHomeState !== "empty" && (
            <RecentActivityCard data-testid="home-recent-activity-card" />
          )}

          <div
            className="overflow-x-auto py-6"
            data-testid="home-mobile-stats-wrapper"
          >
            <HomeStatsStrip />
          </div>
        </div>

        <Card
          variant="white"
          className="hidden !border-0 p-8 md:block"
          data-node-id="1497:94565"
          data-testid="home-dashboard-card"
        >
          <div
            className="grid w-full grid-cols-7 gap-4"
            data-testid="home-dashboard-grid"
          >
            {isConnected ? (
              <PortfolioPlaceholderCard
                className="col-span-4 row-start-1"
                mobileHomeState={mobileHomeState}
                balanceLabel={splusdBalanceFormatted}
                unrealizedPnlLabel={unrealizedPnlFormatted}
                activePeriodId={portfolioPeriodId}
                onActivePeriodChange={setPortfolioPeriodId}
                series={portfolioSeries}
                data-testid="home-portfolio-placeholder"
              />
            ) : (
              <ConnectWalletPromoCard
                className="col-span-4 row-start-1"
                onConnect={openConnectModal}
                data-testid="home-connect-wallet-card"
              />
            )}

            <div className="relative col-span-3 col-start-5 row-span-2 row-start-1">
              <RecentActivityCard
                className="!absolute inset-0 min-h-0 overflow-hidden"
                data-testid="home-recent-activity-card"
              />
            </div>

            <div
              className="col-span-2 col-start-1 row-start-2 flex flex-col gap-4"
              data-node-id="1497:94675"
              data-testid="home-balances-stack"
            >
              <StartHereCard
                className="flex-1"
                onBuy={onBuy}
                onSell={onSell}
                sellDisabled={sellDisabled}
                data-testid="home-start-here-card"
              />
              <EarnedCard
                earnedPnlLabel={earnedPnlLabel}
                data-testid="home-earned-card"
              />
            </div>

            <StakeCard
              className="col-span-2 col-start-3 row-start-2"
              onStake={onStake}
              onUnstake={onUnstake}
              stakeDisabled={stakeDisabled}
              mobileHomeState={
                isConnected && mobileHomeState === "splusd"
                  ? "splusd"
                  : undefined
              }
              mobileSplusdShares={splusdSharesActive}
              mobileSplusdInPlusd={splusdInPlusdActive}
              splusdUsdValue={splusdBalanceFormatted}
              splusdDecimals={activeDecimals}
              data-testid="home-stake-card"
            />

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
