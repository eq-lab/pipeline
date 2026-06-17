import { useState, useCallback, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { parseUnits, formatUnits } from "@/wallet";
import {
  Button,
  Card,
  InfoRow,
  SegmentedTabs,
  StakeHeader,
  StepsCard,
  TokenAmountDisplay,
  TokenInput,
} from "@pipeline/ui";
import {
  useEvmWallet,
  useEvmToken,
  useStakedPlusdAsset,
  useStakedPlusdConvertToShares,
  useStakedPlusdConvertToAssets,
  useStake,
  useUnstake,
  useNetworkFeeEstimate,
} from "@/wallet";
import { ENV } from "@/lib/env";
import { parseUsdc, formatUsdc } from "@/lib/usdc";

/**
 * Stake route — full page composition.
 *
 * Drives two flows from on-chain reads:
 *
 * **Stake tab** — two steps: Approve PLUSD spend on the sPLUSD vault, then
 * Stake (`sPLUSD.deposit(assets, receiver=connectedWallet)`).
 *
 * **Unstake tab** — single step: Unstake (`sPLUSD.redeem(shares, receiver,
 * owner)` where both receiver and owner are the connected wallet). No approval
 * gate because the caller is the share owner.
 *
 * State sources:
 *   - `useStakedPlusdAsset()` — PLUSD token address from the vault's `asset()`
 *   - `useToken({ token: plusdAddr, spender: splusdAddr })` — PLUSD balance + allowance
 *   - `useToken({ token: splusdAddr })` — sPLUSD balance (no spender = no approval)
 *   - `useStake()` / `useUnstake()` — write surfaces
 *   - `useStakedPlusdConvertToShares()` / `useStakedPlusdConvertToAssets()` — preview
 *
 * Tab switching clears the amount input and resets write surfaces so no stale
 * Done badge from a previous tab can bleed into the new tab.
 *
 * Wallet-disconnected state:
 *   When the wallet is not connected, a yellow "Connect your wallet first"
 *   banner with a dark "Connect" button is shown in place of the StepsCard
 *   for both the Stake and Unstake tabs. The combined conversion card
 *   remains visible above the banner.
 *   The banner's Connect button calls `connect()` from `useEvmWallet()`,
 *   identical to the deposit page and home-page CTA.
 *   Figma: node 1994-7280.
 *
 * Token discipline: no raw colors, fonts, sizes, or radii. Everything goes
 * through design tokens or component primitives from `@pipeline/ui`.
 *
 * Figma reference: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1498-101158&m=dev
 */

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

/**
 * convertToShares / convertToAssets return values scaled to 18 decimal places
 * regardless of the sPLUSD contract address configured in ENV, because the
 * convert-mock convention in useStakedPlusd.ts (RATE_SCALE = 1e18) is address-
 * independent. Hard-coding this here avoids depending on a live `decimals()`
 * RPC read that can resolve to a different value (e.g. 6) when the env address
 * doesn't match the fixture address used by the mock layer.
 *
 * If sPLUSD or PLUSD ever become non-18-decimal tokens, update this constant
 * and the convert-mock convention together.
 */
const CONVERT_DECIMALS = 18;

/**
 * Formats a bigint to exactly 4 decimal places (truncated, not rounded).
 * Used for exchange-rate display rows.
 */
function formatUnits4(value: bigint, decimals: number): string {
  const full = formatUnits(value, decimals);
  const [integer, fraction = ""] = full.split(".");
  const truncated = (fraction + "0000").slice(0, 4);
  return `${integer}.${truncated}`;
}

function Stake() {
  // ── State sources ─────────────────────────────────────────────────────
  const { isConnected, connect } = useEvmWallet();

  // Derive PLUSD address from the sPLUSD vault's `asset()` call.
  // Fall back to zero-address while loading so downstream hooks are always
  // called with a valid `0x${string}`.
  const { plusd: plusdFromVault } = useStakedPlusdAsset();
  const plusdAddr = (plusdFromVault ?? ZERO_ADDRESS) as `0x${string}`;
  const splusdAddr = ENV.STAKED_PLUSD_ADDRESS as `0x${string}`;

  // Both token surfaces always mounted (React hook rules).
  // Stake-tab input is PLUSD → spender = sPLUSD vault (approval required).
  // Unstake-tab input is sPLUSD → no spender (caller owns shares, no approval).
  const plusdToken = useEvmToken({ token: plusdAddr, spender: splusdAddr });
  const splusdToken = useEvmToken({ token: splusdAddr });

  // Write surfaces — always mounted.
  const stake = useStake();
  const unstake = useUnstake();

  // Network-fee estimates — called unconditionally (Rules of Hooks).
  // Mirrors deposit.tsx:189-190 pattern.
  const { feeEth: stakeFeeEth } = useNetworkFeeEstimate("stake");
  const { feeEth: unstakeFeeEth } = useNetworkFeeEstimate("unstake");

  // ── Local state ───────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<"stake" | "unstake">("stake");
  const [amountInput, setAmountInput] = useState("");

  // ── Derived state — per-tab ───────────────────────────────────────────
  const isStakeTab = activeTab === "stake";

  // Active-tab fee estimate (ETH-denominated, undefined while loading/disconnected).
  const networkFee = isStakeTab ? stakeFeeEth : unstakeFeeEth;

  // Active-tab token resolution.
  const inputToken = isStakeTab ? plusdToken : splusdToken;
  const outputToken = isStakeTab ? splusdToken : plusdToken;

  const decimals = inputToken.decimals;
  const balance = inputToken.balance;
  const formattedInputBalance = inputToken.formattedBalance;
  const formattedOutputBalance = outputToken.formattedBalance;

  // amountBig — parsed against the active input token's decimals.
  const amountBig = parseUsdc(amountInput, decimals);

  // hasBalance gate — amount must be positive and within balance.
  const isReady = decimals !== undefined && balance !== undefined;
  const hasBalance =
    isReady && amountBig > 0n && amountBig <= (balance as bigint);

  // Stake-tab only — approval gate.
  // Using hasSufficientAllowance (not !needsApproval) avoids acting while
  // allowance is undefined (loading). Mirrors withdraw.tsx:207 derivation.
  const allowance = isStakeTab ? plusdToken.allowance : undefined;
  const needsApproval =
    isStakeTab &&
    allowance !== undefined &&
    amountBig > 0n &&
    allowance < amountBig;
  const hasSufficientAllowance =
    isStakeTab &&
    allowance !== undefined &&
    amountBig > 0n &&
    allowance >= amountBig;

  // ── Preview hooks — always called (hook rules); disabled when input is 0 ──
  // Active-tab: pass amountBig when on the right tab; undefined disables.
  // Note: preview is sourced from convertTo* — not from write hook `data`.
  // On the real wagmi path write hooks only resolve to { hash }, not decoded
  // shares/assets. See useStakedPlusd.ts comment on mock-path-only fields.
  const sharesPreview = useStakedPlusdConvertToShares(
    isStakeTab ? amountBig : undefined,
  );
  const assetsPreview = useStakedPlusdConvertToAssets(
    !isStakeTab ? amountBig : undefined,
  );

  // Exchange-rate hooks — called with a fixed "1 unit" to show the rate row.
  // Use CONVERT_DECIMALS (18) rather than the live token decimals read so the
  // input scale matches the convert-mock convention regardless of which sPLUSD
  // contract address is configured in ENV. (The mock convention is address-
  // independent; a live decimals() RPC may return 6 for a different address.)
  const oneStake = isStakeTab ? parseUnits("1", CONVERT_DECIMALS) : undefined;
  const oneUnstake = !isStakeTab
    ? parseUnits("1", CONVERT_DECIMALS)
    : undefined;
  const rateSharesPerPlusd = useStakedPlusdConvertToShares(oneStake);
  const rateAssetsPerSplusd = useStakedPlusdConvertToAssets(oneUnstake);

  // ── Step gates ────────────────────────────────────────────────────────
  const canApprove =
    isStakeTab &&
    isConnected &&
    hasBalance &&
    needsApproval &&
    !plusdToken.isApprovePending &&
    !stake.isSuccess;

  const canStake =
    isStakeTab &&
    isConnected &&
    hasBalance &&
    hasSufficientAllowance &&
    !stake.isPending &&
    !stake.isSuccess;

  const canUnstake =
    !isStakeTab &&
    isConnected &&
    hasBalance &&
    !unstake.isPending &&
    !unstake.isSuccess;

  // ── Step state derivations ────────────────────────────────────────────
  // Step 1 "Done" when allowance covers amount (drives Done badge without
  // explicit approve.reset — see exec plan §Allowance reset risk).
  const step1State =
    isStakeTab && (hasSufficientAllowance || stake.isSuccess) && isConnected
      ? ("success" as const)
      : ("idle" as const);

  const step2State = stake.isSuccess ? ("success" as const) : ("idle" as const);

  const unstakeStepState = unstake.isSuccess
    ? ("success" as const)
    : ("idle" as const);

  // ── Tab-switch handler ─────────────────────────────────────────────────
  // Reset write surfaces and amount input on tab switch so no stale Done badge
  // bleeds across tabs (cross-tab regression guard per exec plan).
  // No explicit approve reset needed — step1State derives from allowance read,
  // not from isApproveSuccess, so it disappears naturally when tab unmounts.
  const onSelectTab = useCallback(
    (next: string) => {
      setActiveTab(next as "stake" | "unstake");
      setAmountInput("");
      stake.reset();
      unstake.reset();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stake.reset, unstake.reset],
  );

  // ── Balance refetch after write success ───────────────────────────────
  useEffect(() => {
    if (stake.isSuccess) {
      plusdToken.refetchBalance();
      splusdToken.refetchBalance();
      plusdToken.refetchAllowance?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stake.isSuccess]);

  useEffect(() => {
    if (unstake.isSuccess) {
      plusdToken.refetchBalance();
      splusdToken.refetchBalance();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unstake.isSuccess]);

  // ── Quick-amount handler ───────────────────────────────────────────────
  // Chips operate on the active tab's input balance: PLUSD on Stake, sPLUSD on Unstake.
  const onQuickAmount = useCallback(
    (idx: number) => {
      if (decimals === undefined || balance === undefined) return;
      let next: bigint;
      if (idx === 0) next = ((balance as bigint) * 25n) / 100n;
      else if (idx === 1) next = (balance as bigint) / 2n;
      else if (idx === 2) next = ((balance as bigint) * 75n) / 100n;
      else if (idx === 3) next = balance as bigint;
      else return;
      setAmountInput(formatUsdc(next, decimals).replace(/,/g, ""));
    },
    [balance, decimals],
  );

  // ── Preview render values ──────────────────────────────────────────────
  // Format convert-hook outputs against CONVERT_DECIMALS (18) — not the live
  // token decimals read — because convertToShares / convertToAssets return
  // values in 18-decimal base units per the convert-mock convention.
  const previewOutputValue = isStakeTab
    ? sharesPreview.data !== undefined
      ? formatUsdc(sharesPreview.data, CONVERT_DECIMALS).replace(/,/g, "")
      : "0"
    : assetsPreview.data !== undefined
      ? formatUsdc(assetsPreview.data, CONVERT_DECIMALS).replace(/,/g, "")
      : "0";

  // Exchange-rate row text (truncated to 4 dp, not rounded).
  // Format against CONVERT_DECIMALS (18) — not the live token decimals read —
  // because convertToShares / convertToAssets return 18-decimal values per the
  // convert-mock convention.
  const exchangeRateText = (() => {
    if (isStakeTab) {
      if (rateSharesPerPlusd.data === undefined) return "—";
      const n = formatUnits4(rateSharesPerPlusd.data, CONVERT_DECIMALS);
      return `1 PLUSD = ${n} sPLUSD`;
    }
    if (rateAssetsPerSplusd.data === undefined) return "—";
    const n = formatUnits4(rateAssetsPerSplusd.data, CONVERT_DECIMALS);
    return `1 sPLUSD = ${n} PLUSD`;
  })();

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div
      data-testid="stake-page-root"
      className="min-h-screen bg-[var(--color-pipeline-paper)] text-[color:var(--color-pipeline-ink)]"
    >
      {/* Centred narrow column — mirrors Figma's centred single-column layout
          for the stake screen. py-12 gives breathing room under the TopBar;
          gap-6 (24px) matches the vertical spacing between sections. */}
      <main
        data-testid="stake-main"
        className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-12"
      >
        {/* Section header: chart hero icon + yield rate */}
        {/* TODO(#APR-followup): wire live yield rate; out of scope for #310 */}
        <StakeHeader data-testid="stake-header" title="Earn 8.42% p.a." />

        {/* Combined conversion card: tab switcher + input + output/rates.
            Figma node 1498-101158 / input section 1500-102009: the two
            sub-sections (input-sum-inline) share the same white card with
            zero gap between them, creating one seamless conversion card. */}
        <Card
          variant="white"
          padding="none"
          data-testid="stake-conversion-card"
          className="flex flex-col gap-0 overflow-hidden"
        >
          {/* Input sub-section: tabs + token amount input */}
          <div
            data-testid="stake-input-section"
            className="flex flex-col gap-4 p-4"
          >
            <SegmentedTabs
              data-testid="stake-tabs"
              tabs={[
                { id: "stake", label: "Stake" },
                { id: "unstake", label: "Unstake" },
              ]}
              activeId={activeTab}
              onSelect={onSelectTab}
            />

            <TokenInput
              token={isStakeTab ? "plusd" : "splusd"}
              tokenLabel={isStakeTab ? "PLUSD" : "sPLUSD"}
              balanceLabel={
                formattedInputBalance
                  ? formattedInputBalance.replace(/^\$/, "")
                  : "—"
              }
              placeholderValue="0"
              value={amountInput}
              onValueChange={setAmountInput}
              disabled={!isConnected || !isReady}
              quickAmounts={[
                { label: "25%" },
                { label: "50%" },
                { label: "75%" },
                { label: "Max" },
              ]}
              onQuickAmountClick={onQuickAmount}
            />
          </div>

          {/* Output sub-section: preview amount + exchange rate + network fee */}
          <div
            data-testid="stake-output-section"
            className="flex flex-col gap-4 p-4"
          >
            <TokenAmountDisplay
              token={isStakeTab ? "splusd" : "plusd"}
              tokenLabel={isStakeTab ? "sPLUSD" : "PLUSD"}
              balanceLabel={
                formattedOutputBalance
                  ? formattedOutputBalance.replace(/^\$/, "")
                  : "—"
              }
              value={previewOutputValue}
            />
            <InfoRow label="Exchange rate" value={exchangeRateText} />
            <InfoRow label="Network fee" value={networkFee ?? "—"} />
          </div>
        </Card>

        {/* Steps card — conditional on wallet connection and activeTab */}
        {!isConnected ? (
          /* Wallet-not-connected banner. Figma: node 1994-7280. */
          <Card
            variant="yellow"
            data-testid="connect-wallet-banner"
            className="flex flex-row items-center justify-between gap-4 !border-t !border-r-[3px] !border-b-[3px] !border-l"
          >
            <p
              data-testid="stake-connect-message"
              className="font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-body)]"
            >
              Connect your wallet first
            </p>
            <Button
              variant="primary-dark"
              data-testid="stake-connect-button"
              className="whitespace-nowrap"
              onClick={connect}
            >
              Connect
            </Button>
          </Card>
        ) : isStakeTab ? (
          <StepsCard
            data-testid="stake-steps-card"
            steps={[
              {
                label: "Allow Pipeline to use PLUSD",
                actionLabel: "Approve",
                disabled: !canApprove,
                loading: plusdToken.isApprovePending,
                state: step1State,
                onAction: () => plusdToken.approve?.(amountBig),
              },
              {
                label: "Confirm and stake PLUSD",
                actionLabel: "Stake",
                disabled: !canStake,
                loading: stake.isPending,
                state: step2State,
                onAction: () => stake.write(amountBig),
              },
            ]}
          />
        ) : (
          <StepsCard
            data-testid="stake-unstake-steps"
            steps={[
              {
                label: "Confirm and unstake sPLUSD",
                actionLabel: "Unstake",
                disabled: !canUnstake,
                loading: unstake.isPending,
                state: unstakeStepState,
                onAction: () => unstake.write(amountBig),
              },
            ]}
          />
        )}
      </main>
    </div>
  );
}

export const Route = createFileRoute("/stake")({
  component: Stake,
});
