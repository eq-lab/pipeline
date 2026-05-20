import { useState, useCallback, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { parseUnits, formatUnits } from "@/wallet";
import {
  Card,
  InfoRow,
  SegmentedTabs,
  StakeHeader,
  StepsCard,
  TokenAmountDisplay,
  TokenInput,
} from "@pipeline/ui";
import {
  useWallet,
  useToken,
  useStakedPlusdAsset,
  useStakedPlusdConvertToShares,
  useStakedPlusdConvertToAssets,
  useStake,
  useUnstake,
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
 * Token discipline: no raw colors, fonts, sizes, or radii. Everything goes
 * through design tokens or component primitives from `@pipeline/ui`.
 *
 * Figma reference: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1498-101158&m=dev
 */

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

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
  const { isConnected } = useWallet();

  // Derive PLUSD address from the sPLUSD vault's `asset()` call.
  // Fall back to zero-address while loading so downstream hooks are always
  // called with a valid `0x${string}`.
  const { plusd: plusdFromVault } = useStakedPlusdAsset();
  const plusdAddr = (plusdFromVault ?? ZERO_ADDRESS) as `0x${string}`;
  const splusdAddr = ENV.STAKED_PLUSD_ADDRESS as `0x${string}`;

  // Both token surfaces always mounted (React hook rules).
  // Stake-tab input is PLUSD → spender = sPLUSD vault (approval required).
  // Unstake-tab input is sPLUSD → no spender (caller owns shares, no approval).
  const plusdToken = useToken({ token: plusdAddr, spender: splusdAddr });
  const splusdToken = useToken({ token: splusdAddr });

  // Write surfaces — always mounted.
  const stake = useStake();
  const unstake = useUnstake();

  // ── Local state ───────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<"stake" | "unstake">("stake");
  const [amountInput, setAmountInput] = useState("");

  // ── Derived state — per-tab ───────────────────────────────────────────
  const isStakeTab = activeTab === "stake";

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
  // When decimals are not yet loaded we pass undefined so the hook short-circuits.
  const oneStake =
    isStakeTab && plusdToken.decimals !== undefined
      ? parseUnits("1", plusdToken.decimals)
      : undefined;
  const oneUnstake =
    !isStakeTab && splusdToken.decimals !== undefined
      ? parseUnits("1", splusdToken.decimals)
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
  const previewOutputValue = isStakeTab
    ? sharesPreview.data !== undefined && splusdToken.decimals !== undefined
      ? formatUsdc(sharesPreview.data, splusdToken.decimals).replace(/,/g, "")
      : "0"
    : assetsPreview.data !== undefined && plusdToken.decimals !== undefined
      ? formatUsdc(assetsPreview.data, plusdToken.decimals).replace(/,/g, "")
      : "0";

  // Exchange-rate row text (truncated to 4 dp, not rounded).
  const exchangeRateText = (() => {
    if (isStakeTab) {
      if (
        rateSharesPerPlusd.data === undefined ||
        splusdToken.decimals === undefined
      )
        return "—";
      const n = formatUnits4(rateSharesPerPlusd.data, splusdToken.decimals);
      return `1 PLUSD = ${n} sPLUSD`;
    }
    if (
      rateAssetsPerSplusd.data === undefined ||
      plusdToken.decimals === undefined
    )
      return "—";
    const n = formatUnits4(rateAssetsPerSplusd.data, plusdToken.decimals);
    return `1 sPLUSD = ${n} PLUSD`;
  })();

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[var(--color-pipeline-paper)] text-[color:var(--color-pipeline-ink)]">
      {/* Centred narrow column — mirrors Figma's centred single-column layout
          for the stake screen. py-12 gives breathing room under the TopBar;
          gap-6 (24px) matches the vertical spacing between sections. */}
      <main className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-12">
        {/* Section header: chart hero icon + yield rate */}
        {/* TODO(#APR-followup): wire live yield rate; out of scope for #310 */}
        <StakeHeader title="Earn 8.42% p.a." />

        {/* Input card: tab switcher + token amount input */}
        <Card variant="white" className="flex flex-col gap-4">
          <SegmentedTabs
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
        </Card>

        {/* Output card: preview amount + exchange rate + network fee */}
        <Card variant="white" className="flex flex-col gap-4">
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
          <InfoRow label="Network fee" value="—" />
        </Card>

        {/* Steps card — conditional on activeTab */}
        {isStakeTab ? (
          <StepsCard
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
