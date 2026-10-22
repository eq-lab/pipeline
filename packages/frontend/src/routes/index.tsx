// spec: docs/frontend/dashboard-components.md#home-route
import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Card } from "@pipeline/ui";
import { ENV } from "@/lib/env";
import { useAuthFlow, useAuthSession } from "@/auth";
import {
  formatBigintCurrency,
  formatRawDecimalUSD,
  isDisplayZero,
} from "@/lib/format";

import {
  useEvmWallet,
  useStellarWallet,
  useWalletView,
  useWalletPresence,
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
import { AddUsdCard } from "@/components/AddUsdCard";
import { RecentActivityCard } from "@/components/RecentActivityCard";
import {
  CompactAddUsdStack,
  CompactBalances,
  HomeDashboardGrid,
  LoadingBlock,
} from "./-HomeDashboardGrid";
import { FundingDetailsModal } from "@/components/FundingDetailsModal";
import { usePnl, usePositionsHistory } from "@/api";
import { DEFAULT_PERIOD_ID, buildSeries } from "@/components/usePortfolioChart";
import { computeAxisTicks } from "@/utils/chartAxis";
import { deriveHomeState } from "@/components/homeState";
import { useChainServed } from "@/api";
import { ChainNotServedNotice } from "@/components/ChainNotServedNotice";

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
  const [fundingDetailsOpen, setFundingDetailsOpen] = useState(false);
  const evm = useEvmWallet();
  const stellar = useStellarWallet();
  const { kind } = useWalletView();
  const { isAnyConnected } = useWalletPresence();
  const { served: chainServed, chainName } = useChainServed();
  const isConnected =
    kind === "stellar" ? stellar.isConnected : evm.isConnected;
  const pnl = usePnl();
  const [portfolioPeriodId, setPortfolioPeriodId] = useState(DEFAULT_PERIOD_ID);
  const positionsHistory = usePositionsHistory(portfolioPeriodId);

  const { open: openConnectModal } = useConnectModal();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuthSession();
  const {
    open: openAuthFlow,
    lpRead,
    kybStatus,
    openAccountSetup,
    openAddEmail,
  } = useAuthFlow();
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

  const homeState = deriveHomeState({
    hasSession: isAuthenticated,
    isConnected,
    lpRead,
    kybStatus,
    plusdIsZero: isDisplayZero(plusdBalanceActive, activeDecimals),
    splusdIsZero: isDisplayZero(splusdSharesActive, activeDecimals),
  });

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

  const sharesStats = positionsHistory.data?.shares_balance;
  const portfolioAxisMax =
    sharesStats?.max != null
      ? Number(sharesStats.max) / 10 ** activeDecimals
      : null;
  const portfolioAxis = computeAxisTicks(portfolioAxisMax);

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
  const onViewStatus = () =>
    navigate({ to: "/account", search: { state: undefined } });
  const onAddFunds = () => setFundingDetailsOpen(true);

  const onSignUp = () => openAuthFlow("create-account");

  const portfolioChartProps = {
    className: "col-span-4 row-start-1",
    activePeriodId: portfolioPeriodId,
    onActivePeriodChange: setPortfolioPeriodId,
    series: portfolioSeries,
    yAxis: portfolioAxis,
    yAxisDomainMax: portfolioAxisMax,
    "data-testid": "home-portfolio-placeholder",
  };
  const compactWalletActions = {
    onBuy,
    onSell,
    sellDisabled,
    onStake,
    onUnstake,
    stakeDisabled,
  };

  return (
    <div
      className="min-h-screen bg-[var(--color-pipeline-paper)] text-[color:var(--color-pipeline-ink)]"
      data-testid="home-page-root"
    >
      <main
        className="mx-auto flex w-full max-w-[1200px] flex-col gap-4 px-2 py-12 md:gap-12 md:px-0"
        data-testid="home-main"
      >
        <WelcomeHeader
          isReturning={isAuthenticated || isAnyConnected}
          data-testid="home-welcome-header"
        />

        {chainServed === false ? (
          <ChainNotServedNotice chainName={chainName} />
        ) : (
          <>
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
                  yAxis={portfolioAxis}
                  yAxisDomainMax={portfolioAxisMax}
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
              {homeState === "loading" ? (
                <HomeDashboardGrid
                  busy
                  hero={
                    <LoadingBlock className="col-span-4 row-start-1 h-[274px]" />
                  }
                  activityPadding="md"
                  balances={
                    <>
                      <LoadingBlock className="h-[164px]" />
                      <LoadingBlock className="h-[164px]" />
                    </>
                  }
                  third={
                    <div className="col-span-2 col-start-3 row-start-2 flex flex-col gap-4">
                      <LoadingBlock className="h-[246px]" />
                      <LoadingBlock className="h-[82px]" />
                    </div>
                  }
                />
              ) : homeState === "zero" ? (
                <HomeDashboardGrid
                  hero={
                    <ConnectWalletPromoCard
                      className="col-span-4 row-start-1"
                      variant="get-started"
                      onConnect={onSignUp}
                      data-testid="home-connect-wallet-card"
                    />
                  }
                  activityPadding="md"
                  balancesNodeId="6701:98347"
                  balances={
                    <CompactBalances
                      onBuy={onSignUp}
                      onSell={onSignUp}
                      sellDisabled
                      onStake={onSignUp}
                      onUnstake={onSignUp}
                    />
                  }
                  third={
                    <CompactAddUsdStack nodeId="6701:98377">
                      <AddUsdCard
                        variant="locked"
                        className="flex-1"
                        data-testid="home-add-usd-card"
                      />
                    </CompactAddUsdStack>
                  }
                />
              ) : homeState === "wallet-only" ? (
                <HomeDashboardGrid
                  hero={
                    <PortfolioPlaceholderCard
                      variant="get-plusd"
                      balanceLabel={splusdBalanceFormatted}
                      {...portfolioChartProps}
                    />
                  }
                  activityPadding="md"
                  balancesNodeId="7149:16787"
                  balances={<CompactBalances {...compactWalletActions} />}
                  third={
                    <CompactAddUsdStack nodeId="7149:16152">
                      <AddUsdCard
                        variant="verify"
                        onStartVerification={openAddEmail}
                        data-testid="home-add-usd-card"
                      />
                    </CompactAddUsdStack>
                  }
                />
              ) : homeState === "unverified" ? (
                <HomeDashboardGrid
                  hero={
                    <PortfolioPlaceholderCard
                      variant="connect-wallet"
                      onConnectWallet={openConnectModal}
                      {...portfolioChartProps}
                    />
                  }
                  activityPadding="md"
                  balancesNodeId="6701:97659"
                  balances={
                    <CompactBalances
                      onBuy={onBuy}
                      onSell={onSell}
                      sellDisabled={sellDisabled}
                      onStake={onStake}
                      onUnstake={onUnstake}
                    />
                  }
                  third={
                    <CompactAddUsdStack nodeId="6701:97694">
                      <AddUsdCard
                        variant="verify"
                        onStartVerification={openAccountSetup}
                        data-testid="home-add-usd-card"
                      />
                    </CompactAddUsdStack>
                  }
                />
              ) : homeState === "kyb-pending" ? (
                <HomeDashboardGrid
                  hero={
                    <PortfolioPlaceholderCard
                      variant="get-plusd"
                      balanceLabel={splusdBalanceFormatted}
                      {...portfolioChartProps}
                    />
                  }
                  activityPadding="md"
                  balancesNodeId="6701:98773"
                  balances={<CompactBalances {...compactWalletActions} />}
                  third={
                    <CompactAddUsdStack nodeId="6701:98538">
                      <AddUsdCard
                        variant="verifying"
                        onViewStatus={onViewStatus}
                        data-testid="home-add-usd-card"
                      />
                    </CompactAddUsdStack>
                  }
                />
              ) : homeState === "plusd-held" ? (
                <HomeDashboardGrid
                  hero={
                    <PortfolioPlaceholderCard
                      variant="stake-or-add-usd"
                      balanceLabel={splusdBalanceFormatted}
                      onAddFunds={onAddFunds}
                      {...portfolioChartProps}
                    />
                  }
                  activityPadding="md"
                  balancesNodeId="6701:97461"
                  balances={
                    <CompactBalances
                      {...compactWalletActions}
                      compactVariant="balance"
                      compactBalanceLabel={plusdFormattedActive}
                    />
                  }
                  third={
                    <CompactAddUsdStack nodeId="6701:97493">
                      <AddUsdCard
                        variant="unlocked"
                        className="flex-1"
                        onAddFunds={onAddFunds}
                        data-testid="home-add-usd-card"
                      />
                    </CompactAddUsdStack>
                  }
                />
              ) : homeState === "kyb-problem" ? (
                <HomeDashboardGrid
                  hero={
                    <PortfolioPlaceholderCard
                      variant={isConnected ? "get-plusd" : "connect-wallet"}
                      onConnectWallet={openConnectModal}
                      balanceLabel={splusdBalanceFormatted}
                      {...portfolioChartProps}
                    />
                  }
                  activityPadding="md"
                  balancesNodeId="6702:104425"
                  balances={<CompactBalances {...compactWalletActions} />}
                  third={
                    <CompactAddUsdStack nodeId="6702:104190">
                      <AddUsdCard
                        variant="declined"
                        onViewStatus={onViewStatus}
                        data-testid="home-add-usd-card"
                      />
                    </CompactAddUsdStack>
                  }
                />
              ) : (
                <HomeDashboardGrid
                  hero={
                    isConnected ? (
                      <PortfolioPlaceholderCard
                        mobileHomeState={mobileHomeState}
                        balanceLabel={splusdBalanceFormatted}
                        unrealizedPnlLabel={unrealizedPnlFormatted}
                        {...portfolioChartProps}
                      />
                    ) : (
                      <ConnectWalletPromoCard
                        className="col-span-4 row-start-1"
                        onConnect={openConnectModal}
                        data-testid="home-connect-wallet-card"
                      />
                    )
                  }
                  balancesNodeId="1497:94675"
                  balances={
                    <>
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
                    </>
                  }
                  third={
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
                  }
                />
              )}
            </Card>
          </>
        )}
      </main>

      <FundingDetailsModal
        open={fundingDetailsOpen}
        onDismiss={() => setFundingDetailsOpen(false)}
      />
    </div>
  );
}

export const Route = createFileRoute("/")({
  component: Home,
});
