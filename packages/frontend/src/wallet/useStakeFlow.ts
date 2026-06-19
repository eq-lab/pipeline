/**
 * Chain-agnostic stake/unstake flow adapter.
 *
 * Provides a unified `StakeFlowState` shape that the stake/unstake route
 * (`src/routes/stake.tsx`) consumes instead of calling EVM hooks directly.
 *
 * Architecture
 * ------------
 * All hooks (both EVM and Stellar, both stake and unstake directions) are
 * called unconditionally inside `useStakeFlow` — mirroring `useDepositFlow`.
 * At the end, the active-chain / active-tab values are selected and returned
 * as `StakeFlowState`.
 *
 * StakeFlowState shape
 * --------------------
 * The component reads ONLY from `StakeFlowState`. Chain-specific details are
 * hidden inside this hook. Toast state helpers (`step1Tx`, `step2Tx`) are
 * included so the component can emit toasts without knowing the chain.
 *
 * Design choices
 * --------------
 * - `amountBig` is passed in from the component (parsed from the text input).
 * - All hooks are called unconditionally; inactive-chain/direction hooks are
 *   disabled via their own `enabled`/`requestId === undefined` guards.
 * - On Stellar, `convertDecimals` is 7 (SAC scale), not 18 (EVM scale).
 * - Steps shape by (chain, tab):
 *     EVM Stake:      [approve, stake]    (StepsCard 2 rows)
 *     EVM Unstake:    [unstake]           (StepsCard 1 row)
 *     Stellar Stake:  [enableSplusd, stake] (StepsCard 2 rows)
 *     Stellar Unstake:[enablePlusd, unstake] (StepsCard 2 rows)
 */

import { useCallback } from "react";
import {
  useWalletView,
  // EVM
  useEvmWallet,
  useEvmToken,
  useStakedPlusdAsset,
  useStake,
  useUnstake,
  useStakedPlusdConvertToShares,
  useStakedPlusdConvertToAssets,
  useNetworkFeeEstimate,
  // Stellar
  useStellarWallet,
  useStellarSacToken,
  useStellarToken,
  useStellarDepositManagerAddresses,
  useStellarStake,
  useStellarUnstake,
  useStellarStakeConvertToShares,
  useStellarUnstakeConvertToAssets,
  useStellarStakedPlusdBalance,
  useStellarChangeTrustStakedPlusd,
  useChangeTrust,
  SAC_DECIMALS,
  sacDisplayToRaw,
  useStellarNetworkFeeEstimate,
  parseUnits,
  formatUnits,
} from "@/wallet";
import { ENV } from "@/lib/env";
import { formatUsdc } from "@/lib/usdc";

// ── Types ─────────────────────────────────────────────────────────────────────

export type StakeTab = "stake" | "unstake";

export type StakeStepState = "idle" | "success";

export interface StakeStepInfo {
  label: string;
  actionLabel: string;
  state: StakeStepState;
  loading: boolean;
  disabled: boolean;
  onAction: () => void;
  /** Optional testid hint for the route to pass to the StepsCard. */
  testId?: string;
}

/** Per-step write transaction state — used by the component for toast emission. */
export interface StepTxState {
  isPending: boolean;
  isSuccess: boolean;
  error: Error | null;
}

/**
 * Unified state shape consumed by the stake/unstake route component.
 */
export interface StakeFlowState {
  // ── Connection ─────────────────────────────────────────────────────────
  isConnected: boolean;
  connect: () => void;
  address: string | undefined;

  // ── Token info ─────────────────────────────────────────────────────────
  /** Token decimals at the active chain's balance scale. */
  decimals: number | undefined;
  /**
   * Decimals for the convert hooks' output scale.
   * EVM: 18 (RATE_SCALE = 1e18); Stellar: 7 (SAC_DECIMALS).
   */
  convertDecimals: number;
  /** Formatted input balance string (no $ prefix). */
  formattedInputBalance: string | undefined;
  /** Formatted output balance string (no $ prefix). */
  formattedOutputBalance: string | undefined;
  /** Raw input balance bigint at active-chain decimals */
  balance: bigint | undefined;

  // ── Input derivations ──────────────────────────────────────────────────
  isReady: boolean;
  hasBalance: boolean;

  // ── Preview ────────────────────────────────────────────────────────────
  previewOutputValue: string;
  exchangeRateText: string;

  // ── Network fee ────────────────────────────────────────────────────────
  networkFee: string | undefined;

  // ── Input disabled ─────────────────────────────────────────────────────
  isInputDisabled: boolean;

  // ── Steps ──────────────────────────────────────────────────────────────
  /** Ordered list of steps to render in the StepsCard. */
  steps: StakeStepInfo[];

  // ── Per-step write-state (for toast emission) ─────────────────────────
  step1Tx: StepTxState;
  step2Tx: StepTxState;

  // ── Refetch helpers ───────────────────────────────────────────────────
  refetchBalances: () => void;

  // ── Quick-amount handler ───────────────────────────────────────────────
  onQuickAmount: (idx: number) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

/** EVM convert scale — always 18 regardless of live token decimals read. */
const EVM_CONVERT_DECIMALS = 18;

// ── Format helpers ────────────────────────────────────────────────────────────

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

/**
 * Formats a Stellar SAC raw balance to a plain decimal string (no $ prefix).
 */
function formatStellarBalancePlain(raw: bigint, decimals: number): string {
  const n = Number(raw) / 10 ** decimals;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ── useStakeFlow ──────────────────────────────────────────────────────────────

/**
 * Returns the unified stake/unstake flow state for the active chain and tab.
 * All hooks are called unconditionally.
 *
 * @param tab          - Current tab ("stake" | "unstake").
 * @param amountBig    - Parsed amount from the text input (bigint at active decimals).
 * @param setAmountInput - Input setter (for quick-amount handlers).
 */
export function useStakeFlow(
  tab: StakeTab,
  amountBig: bigint,
  setAmountInput: (v: string) => void,
): StakeFlowState {
  const { kind } = useWalletView();
  const isStellar = kind === "stellar";
  const isStake = tab === "stake";

  // ── EVM: connection + token hooks (called unconditionally) ─────────────────
  const {
    address: evmAddress,
    isConnected: isEvmConnected,
    connect: evmConnect,
  } = useEvmWallet();

  const { plusd: plusdFromVault } = useStakedPlusdAsset();
  const plusdAddr = (plusdFromVault ?? ZERO_ADDRESS) as `0x${string}`;
  const splusdAddr = ENV.STAKED_PLUSD_ADDRESS as `0x${string}`;

  // Stake-tab input: PLUSD → spender = sPLUSD vault (approval required).
  // Unstake-tab input: sPLUSD → no spender (caller owns shares, no approval).
  const evmPlusdToken = useEvmToken({ token: plusdAddr, spender: splusdAddr });
  const evmSplusdToken = useEvmToken({ token: splusdAddr });

  // Write surfaces — always mounted.
  const evmStake = useStake();
  const evmUnstake = useUnstake();

  // Network-fee estimates — called unconditionally.
  const { feeEth: stakeFeeEth } = useNetworkFeeEstimate("stake");
  const { feeEth: unstakeFeeEth } = useNetworkFeeEstimate("unstake");

  // Convert hooks — called unconditionally (disabled via undefined when on wrong tab).
  const evmSharesPreview = useStakedPlusdConvertToShares(
    isStake ? amountBig : undefined,
  );
  const evmAssetsPreview = useStakedPlusdConvertToAssets(
    !isStake ? amountBig : undefined,
  );
  const evmOneStake = isStake
    ? parseUnits("1", EVM_CONVERT_DECIMALS)
    : undefined;
  const evmOneUnstake = !isStake
    ? parseUnits("1", EVM_CONVERT_DECIMALS)
    : undefined;
  const evmRateSharesPerPlusd = useStakedPlusdConvertToShares(evmOneStake);
  const evmRateAssetsPerSplusd = useStakedPlusdConvertToAssets(evmOneUnstake);

  // ── Stellar: connection + token hooks (called unconditionally) ─────────────
  const {
    address: stellarAddress,
    isConnected: isStellarConnected,
    connect: stellarConnect,
  } = useStellarWallet();

  // Resolve PLUSD classic-asset issuer and SAC contract address from the
  // deposit-manager addresses (same source the deposit/withdraw flow uses).
  const { addresses: stellarAddresses } = useStellarDepositManagerAddresses();

  // PLUSD SAC balance — Stake tab input (uses useStellarSacToken for balance,
  // but we need the balance as a raw bigint via sacDisplayToRaw).
  // Mirror the deposit flow: pass the resolved issuer so Horizon matching works
  // on the real (non-mock) path. An empty issuer only matches on the mock path
  // and causes balance to read as 0 in production.
  const stellarPlusdSac = useStellarSacToken({
    assetCode: "PLUSD",
    assetIssuer: stellarAddresses?.plusdAsset.issuer ?? "",
    contractId: stellarAddresses?.plusd ?? "",
  });
  // Also get PLUSD balance via useStellarToken for consistency with TopBar.
  const stellarUsdcToken = useStellarToken();

  // sPLUSD share balance — Unstake tab input (raw bigint from the vault).
  const stellarSplusdBalance = useStellarStakedPlusdBalance();

  // Write surfaces — always mounted.
  const stellarStake = useStellarStake();
  const stellarUnstake = useStellarUnstake();

  // Trustline hooks — always mounted.
  // Stake: needs sPLUSD trustline.
  const splusdTrustline = useStellarChangeTrustStakedPlusd();
  // Unstake: needs PLUSD trustline (same as deposit flow).
  const plusdTrustline = useChangeTrust();

  // Stellar fee estimates — called unconditionally.
  const { feeXlm: stellarStakeFeeXlm } = useStellarNetworkFeeEstimate("stake");
  const { feeXlm: stellarUnstakeFeeXlm } =
    useStellarNetworkFeeEstimate("unstake");

  // Stellar convert hooks — called unconditionally.
  // Stake: PLUSD → sPLUSD
  const stellarSharesPreview = useStellarStakeConvertToShares(
    isStake ? amountBig : undefined,
  );
  const stellarAssetsPreview = useStellarUnstakeConvertToAssets(
    !isStake ? amountBig : undefined,
  );
  const stellarOneStake = isStake
    ? parseUnits("1", SAC_DECIMALS)
    : undefined;
  const stellarOneUnstake = !isStake
    ? parseUnits("1", SAC_DECIMALS)
    : undefined;
  const stellarRateSharesPerPlusd =
    useStellarStakeConvertToShares(stellarOneStake);
  const stellarRateAssetsPerSplusd =
    useStellarUnstakeConvertToAssets(stellarOneUnstake);

  // ── EVM derived state ──────────────────────────────────────────────────────

  const evmInputToken = isStake ? evmPlusdToken : evmSplusdToken;
  const evmOutputToken = isStake ? evmSplusdToken : evmPlusdToken;

  const evmDecimals = evmInputToken.decimals;
  const evmBalance = evmInputToken.balance as bigint | undefined;
  const evmFormattedInputBalance = evmInputToken.formattedBalance;
  const evmFormattedOutputBalance = evmOutputToken.formattedBalance;

  const evmIsReady = evmDecimals !== undefined && evmBalance !== undefined;
  const evmHasBalance =
    evmIsReady && amountBig > 0n && amountBig <= (evmBalance ?? 0n);

  const evmAllowance = isStake ? evmPlusdToken.allowance : undefined;
  const evmNeedsApproval =
    isStake &&
    evmAllowance !== undefined &&
    amountBig > 0n &&
    evmAllowance < amountBig;
  const evmHasSufficientAllowance =
    isStake &&
    evmAllowance !== undefined &&
    amountBig > 0n &&
    evmAllowance >= amountBig;

  const evmCanApprove =
    isStake &&
    isEvmConnected &&
    evmHasBalance &&
    evmNeedsApproval &&
    !evmPlusdToken.isApprovePending &&
    !evmStake.isSuccess;

  const evmCanStake =
    isStake &&
    isEvmConnected &&
    evmHasBalance &&
    evmHasSufficientAllowance &&
    !evmStake.isPending &&
    !evmStake.isSuccess;

  const evmCanUnstake =
    !isStake &&
    isEvmConnected &&
    evmHasBalance &&
    !evmUnstake.isPending &&
    !evmUnstake.isSuccess;

  const evmStep1State: StakeStepState =
    isStake && (evmHasSufficientAllowance || evmStake.isSuccess) && isEvmConnected
      ? "success"
      : "idle";
  const evmStep2State: StakeStepState = evmStake.isSuccess ? "success" : "idle";
  const evmUnstakeStepState: StakeStepState = evmUnstake.isSuccess
    ? "success"
    : "idle";

  // EVM preview and rate.
  const evmPreviewOutputValue = isStake
    ? evmSharesPreview.data !== undefined
      ? formatUsdc(evmSharesPreview.data, EVM_CONVERT_DECIMALS).replace(
          /,/g,
          "",
        )
      : "0"
    : evmAssetsPreview.data !== undefined
      ? formatUsdc(evmAssetsPreview.data, EVM_CONVERT_DECIMALS).replace(
          /,/g,
          "",
        )
      : "0";

  const evmExchangeRateText = (() => {
    if (isStake) {
      if (evmRateSharesPerPlusd.data === undefined) return "—";
      return `1 PLUSD = ${formatUnits4(evmRateSharesPerPlusd.data, EVM_CONVERT_DECIMALS)} sPLUSD`;
    }
    if (evmRateAssetsPerSplusd.data === undefined) return "—";
    return `1 sPLUSD = ${formatUnits4(evmRateAssetsPerSplusd.data, EVM_CONVERT_DECIMALS)} PLUSD`;
  })();

  const evmNetworkFee = isStake ? stakeFeeEth : unstakeFeeEth;

  // ── Stellar derived state ──────────────────────────────────────────────────

  // PLUSD balance (Stake tab input): convert Horizon decimal string to bigint.
  // Use the same approach as the deposit flow (sacDisplayToRaw).
  const stellarPlusdBalanceRaw: bigint | undefined =
    isStellarConnected && stellarPlusdSac.balance !== undefined
      ? (() => {
          try {
            return sacDisplayToRaw(stellarPlusdSac.balance);
          } catch {
            return undefined;
          }
        })()
      : undefined;

  // sPLUSD share balance (Unstake tab input): already a raw bigint from the vault.
  const stellarSplusdBalanceRaw: bigint | undefined =
    stellarSplusdBalance.balance;

  const stellarInputBalance = isStake
    ? stellarPlusdBalanceRaw
    : stellarSplusdBalanceRaw;
  const stellarOutputBalance = isStake
    ? stellarSplusdBalanceRaw
    : stellarPlusdBalanceRaw;

  const stellarFormattedInputBalance =
    stellarInputBalance !== undefined
      ? formatStellarBalancePlain(stellarInputBalance, SAC_DECIMALS)
      : undefined;

  const stellarFormattedOutputBalance =
    stellarOutputBalance !== undefined
      ? formatStellarBalancePlain(stellarOutputBalance, SAC_DECIMALS)
      : undefined;

  const stellarIsReady =
    isStellarConnected && stellarInputBalance !== undefined;
  const stellarHasBalance =
    stellarIsReady && amountBig > 0n && amountBig <= (stellarInputBalance ?? 0n);

  // Trustline states.
  const stellarSplusdNeedsTrustline = splusdTrustline.needsTrustline;
  const stellarPlusdNeedsTrustline = plusdTrustline.needsTrustline;

  // Step gates.
  // Step 1 (trustline) — gated on being connected and amount > 0.
  const canStellarEnableSplusd =
    isStake &&
    isStellarConnected &&
    stellarHasBalance &&
    stellarSplusdNeedsTrustline &&
    !splusdTrustline.isPending;

  const canStellarEnablePlusd =
    !isStake &&
    isStellarConnected &&
    stellarHasBalance &&
    stellarPlusdNeedsTrustline &&
    !plusdTrustline.isPending;

  // Step 2 (stake/unstake) — gated on trustline being present.
  const canStellarStake =
    isStake &&
    isStellarConnected &&
    stellarHasBalance &&
    !stellarSplusdNeedsTrustline &&
    !stellarStake.isPending &&
    !stellarStake.isSuccess;

  const canStellarUnstake =
    !isStake &&
    isStellarConnected &&
    stellarHasBalance &&
    !stellarPlusdNeedsTrustline &&
    !stellarUnstake.isPending &&
    !stellarUnstake.isSuccess;

  // Step states.
  const stellarSplusdTrustlineState: StakeStepState =
    !stellarSplusdNeedsTrustline && isStellarConnected ? "success" : "idle";
  const stellarPlusdTrustlineState: StakeStepState =
    !stellarPlusdNeedsTrustline && isStellarConnected ? "success" : "idle";
  const stellarStakeStepState: StakeStepState = stellarStake.isSuccess
    ? "success"
    : "idle";
  const stellarUnstakeStepState: StakeStepState = stellarUnstake.isSuccess
    ? "success"
    : "idle";

  // Stellar preview and rate.
  const stellarPreviewOutputValue = isStake
    ? stellarSharesPreview.data !== undefined
      ? formatUsdc(stellarSharesPreview.data, SAC_DECIMALS).replace(/,/g, "")
      : "0"
    : stellarAssetsPreview.data !== undefined
      ? formatUsdc(stellarAssetsPreview.data, SAC_DECIMALS).replace(/,/g, "")
      : "0";

  const stellarExchangeRateText = (() => {
    if (isStake) {
      if (stellarRateSharesPerPlusd.data === undefined) return "—";
      return `1 PLUSD = ${formatUnits4(stellarRateSharesPerPlusd.data, SAC_DECIMALS)} sPLUSD`;
    }
    if (stellarRateAssetsPerSplusd.data === undefined) return "—";
    return `1 sPLUSD = ${formatUnits4(stellarRateAssetsPerSplusd.data, SAC_DECIMALS)} PLUSD`;
  })();

  const stellarNetworkFee = isStake ? stellarStakeFeeXlm : stellarUnstakeFeeXlm;

  // ── Quick-amount handlers ──────────────────────────────────────────────────

  const onEvmQuickAmount = useCallback(
    (idx: number) => {
      const bal = evmBalance;
      const dec = evmDecimals;
      if (dec === undefined || bal === undefined) return;
      let next: bigint;
      if (idx === 0) next = (bal * 25n) / 100n;
      else if (idx === 1) next = bal / 2n;
      else if (idx === 2) next = (bal * 75n) / 100n;
      else if (idx === 3) next = bal;
      else return;
      setAmountInput(formatUsdc(next, dec).replace(/,/g, ""));
    },
    [evmBalance, evmDecimals, setAmountInput],
  );

  const onStellarQuickAmount = useCallback(
    (idx: number) => {
      const bal = stellarInputBalance;
      if (bal === undefined) return;
      let next: bigint;
      if (idx === 0) next = (bal * 25n) / 100n;
      else if (idx === 1) next = bal / 2n;
      else if (idx === 2) next = (bal * 75n) / 100n;
      else if (idx === 3) next = bal;
      else return;
      setAmountInput(formatUsdc(next, SAC_DECIMALS).replace(/,/g, ""));
    },
    [stellarInputBalance, setAmountInput],
  );

  // Suppress unused warning for stellarUsdcToken (called unconditionally per
  // Rules of Hooks — not used in the Stellar stake flow but must be mounted).
  void stellarUsdcToken;

  // ── Select the active state by chain ──────────────────────────────────────

  if (!isStellar) {
    // ── EVM path ────────────────────────────────────────────────────────────

    const evmSteps: StakeStepInfo[] = isStake
      ? [
          {
            label: "Allow Pipeline to use PLUSD",
            actionLabel: "Approve",
            state: evmStep1State,
            loading: evmPlusdToken.isApprovePending,
            disabled: !evmCanApprove,
            onAction: () => evmPlusdToken.approve?.(amountBig),
          },
          {
            label: "Confirm and stake PLUSD",
            actionLabel: "Stake",
            state: evmStep2State,
            loading: evmStake.isPending,
            disabled: !evmCanStake,
            onAction: () => evmStake.write(amountBig),
          },
        ]
      : [
          {
            label: "Confirm and unstake sPLUSD",
            actionLabel: "Unstake",
            state: evmUnstakeStepState,
            loading: evmUnstake.isPending,
            disabled: !evmCanUnstake,
            onAction: () => evmUnstake.write(amountBig),
          },
        ];

    return {
      isConnected: isEvmConnected,
      connect: evmConnect,
      address: evmAddress,
      decimals: evmDecimals,
      convertDecimals: EVM_CONVERT_DECIMALS,
      formattedInputBalance: evmFormattedInputBalance
        ? evmFormattedInputBalance.replace(/^\$/, "")
        : undefined,
      formattedOutputBalance: evmFormattedOutputBalance
        ? evmFormattedOutputBalance.replace(/^\$/, "")
        : undefined,
      balance: evmBalance,
      isReady: evmIsReady,
      hasBalance: evmHasBalance,
      previewOutputValue: evmPreviewOutputValue,
      exchangeRateText: evmExchangeRateText,
      networkFee: evmNetworkFee,
      isInputDisabled: !isEvmConnected || !evmIsReady,
      steps: evmSteps,
      step1Tx: {
        isPending: isStake ? evmPlusdToken.isApprovePending : false,
        isSuccess: isStake ? evmPlusdToken.isApproveSuccess : false,
        error: null,
      },
      step2Tx: {
        isPending: isStake ? evmStake.isPending : evmUnstake.isPending,
        isSuccess: isStake ? evmStake.isSuccess : evmUnstake.isSuccess,
        error: isStake ? evmStake.error : evmUnstake.error,
      },
      refetchBalances: () => {
        evmPlusdToken.refetchBalance();
        evmSplusdToken.refetchBalance();
        if (isStake) evmPlusdToken.refetchAllowance?.();
      },
      onQuickAmount: onEvmQuickAmount,
    };
  }

  // ── Stellar path ─────────────────────────────────────────────────────────

  const stellarSteps: StakeStepInfo[] = isStake
    ? [
        {
          label: "Enable sPLUSD",
          actionLabel: "Enable",
          state: stellarSplusdTrustlineState,
          loading: splusdTrustline.isPending,
          disabled: !canStellarEnableSplusd,
          onAction: () => splusdTrustline.submit(),
          testId: "stake-trustline-step",
        },
        {
          label: "Confirm and stake PLUSD",
          actionLabel: "Stake",
          state: stellarStakeStepState,
          loading: stellarStake.isPending,
          disabled: !canStellarStake,
          onAction: () => stellarStake.write(amountBig),
        },
      ]
    : [
        {
          label: "Enable PLUSD",
          actionLabel: "Enable",
          state: stellarPlusdTrustlineState,
          loading: plusdTrustline.isPending,
          disabled: !canStellarEnablePlusd,
          onAction: () => plusdTrustline.submit(),
          testId: "unstake-trustline-step",
        },
        {
          label: "Confirm and unstake sPLUSD",
          actionLabel: "Unstake",
          state: stellarUnstakeStepState,
          loading: stellarUnstake.isPending,
          disabled: !canStellarUnstake,
          onAction: () => stellarUnstake.write(amountBig),
        },
      ];

  return {
    isConnected: isStellarConnected,
    connect: stellarConnect,
    address: stellarAddress,
    decimals: SAC_DECIMALS,
    convertDecimals: SAC_DECIMALS,
    formattedInputBalance: stellarFormattedInputBalance,
    formattedOutputBalance: stellarFormattedOutputBalance,
    balance: stellarInputBalance,
    isReady: stellarIsReady,
    hasBalance: stellarHasBalance,
    previewOutputValue: stellarPreviewOutputValue,
    exchangeRateText: stellarExchangeRateText,
    networkFee: stellarNetworkFee,
    isInputDisabled: !isStellarConnected || !stellarIsReady,
    steps: stellarSteps,
    step1Tx: {
      isPending: isStake ? splusdTrustline.isPending : plusdTrustline.isPending,
      isSuccess: isStake ? splusdTrustline.isSuccess : plusdTrustline.isSuccess,
      error: isStake ? splusdTrustline.error : plusdTrustline.error,
    },
    step2Tx: {
      isPending: isStake ? stellarStake.isPending : stellarUnstake.isPending,
      isSuccess: isStake ? stellarStake.isSuccess : stellarUnstake.isSuccess,
      error: isStake ? stellarStake.error : stellarUnstake.error,
    },
    refetchBalances: () => {
      stellarSplusdBalance.refetch();
      // PLUSD SAC balance refetch via hook's internal mechanism.
      stellarPlusdSac.refetchBalance?.();
    },
    onQuickAmount: onStellarQuickAmount,
  };
}
