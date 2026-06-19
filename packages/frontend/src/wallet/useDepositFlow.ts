/**
 * Chain-agnostic deposit/withdraw flow adapter.
 *
 * Provides a unified `FlowState` shape that the deposit/withdraw route
 * (`src/routes/deposit.tsx`) consumes instead of calling EVM hooks directly.
 *
 * Architecture
 * ------------
 * All hooks (both EVM and Stellar, both deposit and withdraw directions) are
 * called unconditionally inside `useDepositFlow` — just as the original
 * `deposit.tsx` called both deposit and withdraw hooks unconditionally and
 * branched by direction. At the end, the active-chain / active-direction
 * values are selected and returned as `FlowState`.
 *
 * FlowState shape
 * ---------------
 * The component reads ONLY from `FlowState`. Chain-specific details are hidden
 * inside this hook. Toast state helpers (`step1IsPending`, `step1IsSuccess`,
 * `step1Error`, etc.) are included so the component can emit toasts without
 * knowing the chain.
 *
 * Design choices
 * --------------
 * - `amountBig` is passed in from the component (parsed from the text input).
 * - All hooks are called unconditionally; inactive-chain/direction hooks are
 *   disabled via their own `enabled`/`requestId === undefined` guards.
 * - Stellar balance arrives as a Horizon human-decimal string (e.g. `"1.5"`);
 *   we convert to bigint at 7 dp (`sacDisplayToRaw`) for amount comparisons.
 * - On Stellar, `trustlines` always contains two entries: PLUSD (index 0) and
 *   USDC (index 1). Both are shown in the StepsCard as steps 1 and 2 regardless
 *   of direction. On EVM, `trustlines` is always empty.
 */

import { useCallback } from "react";
import {
  useWalletView,
  // EVM
  useEvmWallet,
  useDepositManagerAddresses,
  useDepositManagerMinDeposit,
  useEvmToken,
  useRequestDeposit,
  useClaim,
  useRequestWithdrawal,
  useClaimWithdrawal,
  useNetworkFeeEstimate,
  // Stellar
  useStellarWallet,
  useStellarDepositManagerAddresses,
  useStellarSacToken,
  useStellarToken,
  SAC_DECIMALS,
  sacDisplayToRaw,
  useStellarRequestDeposit,
  useStellarClaim,
  useStellarDepositRequest,
  useChangeTrust,
  useStellarRequestWithdrawal,
  useStellarClaimWithdrawal,
  useStellarWithdrawalRequest,
  useStellarChangeTrustUsdc,
  readInflightDeposit,
  readInflightWithdrawal,
  useStellarNetworkFeeEstimate,
} from "@/wallet";
import {
  useRequests,
  useDepositVoucher,
  useWithdrawalVoucher,
  useStellarDepositVoucher,
  useStellarWithdrawalVoucher,
} from "@/api";
import { ENV } from "@/lib/env";
import { formatUsdc, formatUsdcCurrencyCompact } from "@/lib/usdc";

// ── Types ─────────────────────────────────────────────────────────────────────

export type Direction = "deposit" | "withdraw";

export type StepState = "idle" | "success";

export interface StepInfo {
  label: string;
  actionLabel: string;
  state: StepState;
  loading: boolean;
  disabled: boolean;
  onAction: () => void;
}

/** Per-step write transaction state — used by the component for toast emission. */
export interface StepTxState {
  isPending: boolean;
  isSuccess: boolean;
  error: Error | null;
}

/**
 * Per-asset Stellar trustline descriptor.
 *
 * On Stellar, `FlowState.trustlines` always contains two entries:
 *   [0] PLUSD, [1] USDC — regardless of direction.
 * On EVM, `FlowState.trustlines` is always empty ([]).
 */
export interface TrustlineInfo {
  /** Protocol asset code. */
  asset: "PLUSD" | "USDC";
  /** True when the trustline is absent (must be enabled). */
  needsTrustline: boolean;
  /** True when the trustline is present (!needsTrustline and status is known). */
  isEnabled: boolean;
  /** True while the enable transaction is in-flight. */
  enabling: boolean;
  /** Non-null when the most recent enable attempt failed. */
  error: Error | null;
  /** Call to submit the enable (changeTrust) transaction. */
  onEnable: () => void;
  /** Transaction lifecycle for per-asset toast emission. */
  tx: StepTxState;
}

/**
 * Unified state shape consumed by the deposit/withdraw route component.
 */
export interface FlowState {
  // ── Connection ─────────────────────────────────────────────────────────
  isConnected: boolean;
  connect: () => void;
  address: string | undefined;

  // ── Token info ─────────────────────────────────────────────────────────
  decimals: number | undefined;
  /** Formatted balance string with $ prefix (e.g. "$1,000.00") */
  formattedBalance: string | undefined;
  /** Raw balance bigint at active-chain decimals */
  balance: bigint | undefined;

  // ── Min deposit ────────────────────────────────────────────────────────
  /** Min deposit expressed in active-chain decimals */
  minDeposit: bigint | undefined;
  /** Quick-amount chip label (e.g. "$1,000 (Min)") */
  minChipLabel: string;

  // ── Input derivations ──────────────────────────────────────────────────
  isReady: boolean;
  /** Deposit: balance >= minDeposit.  Withdraw: true when balance loaded. */
  hasBalance: boolean | undefined;
  meetsMin: boolean;
  /** True while the active-direction balance query OR the requests API query is still loading,
   *  or while the wallet is connected but the active balance is still undefined
   *  (e.g. during the addresses-resolver window before the token query becomes enabled). */
  isDataPending: boolean;

  // ── Amount lock (in-flight request locks the input) ───────────────────
  isAmountLocked: boolean;
  lockedAmountRaw: bigint | undefined;

  // ── Request state ──────────────────────────────────────────────────────
  requestId: string | undefined;
  requestIsConfirmed: boolean;
  isPendingVerification: boolean;

  // ── Steps ──────────────────────────────────────────────────────────────
  step1: StepInfo;
  step2: StepInfo;
  step3: StepInfo;

  // ── Per-step write-state (for toast emission) ─────────────────────────
  step1Tx: StepTxState;
  step2Tx: StepTxState;
  step3Tx: StepTxState;

  // ── Derived display ────────────────────────────────────────────────────
  isAnyTxInFlight: boolean;
  isInputFaded: boolean;
  networkFee: string | undefined;

  // ── Refetch helpers ───────────────────────────────────────────────────
  refetchBalance: () => void;

  // ── Quick-amount handler ───────────────────────────────────────────────
  onQuickAmount: (idx: number) => void;

  // ── Stellar trustline statuses (direction-independent) ────────────────
  /**
   * On Stellar: always [PLUSD, USDC] — both rendered inside the StepsCard.
   * On EVM: always [] — no trustline UI rendered.
   */
  trustlines: TrustlineInfo[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
/**
 * Frontend minimum deposit for Stellar in tokens at 7 decimals.
 * $1,000 at 7 dp = 1000 × 10^7 = 10_000_000_000n.
 * Soroban exposes no on-chain minimum getter; keep this Stellar-specific
 * frontend rule until the contract or API provides a network value.
 * Reverts #598 (which lowered this to $1); restored to $1,000 by #641.
 */
const STELLAR_MIN_DEPOSIT = 1000n * 10n ** BigInt(SAC_DECIMALS);

// ── Format helper ─────────────────────────────────────────────────────────────

function formatStellarBalance(raw: bigint, decimals: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(raw) / 10 ** decimals);
}

function parseRequestId(value: string | undefined): bigint | undefined {
  if (value === undefined) return undefined;
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}

// ── useDepositFlow ────────────────────────────────────────────────────────────

/**
 * Returns the unified deposit/withdraw flow state for the active chain and
 * direction. All hooks are called unconditionally.
 *
 * @param direction - Current direction ("deposit" | "withdraw").
 * @param amountBig - Parsed amount from the text input (bigint at active decimals).
 * @param setAmountInput - Input setter (for quick-amount handlers).
 */
export function useDepositFlow(
  direction: Direction,
  amountBig: bigint,
  setAmountInput: (v: string) => void,
): FlowState {
  const { kind } = useWalletView();
  const isStellar = kind === "stellar";
  const isDeposit = direction === "deposit";

  // ── EVM: connection + token hooks (called unconditionally) ─────────────────
  const {
    address: evmAddress,
    isConnected: isEvmConnected,
    connect: evmConnect,
  } = useEvmWallet();

  const { plusd: plusdFromManager, usdc } = useDepositManagerAddresses();
  const { minDeposit: evmMinDeposit } = useDepositManagerMinDeposit();

  const usdcAddr = (usdc ?? ZERO_ADDRESS) as `0x${string}`;
  const {
    decimals: evmDepositDecimals,
    balance: evmDepositBalance,
    formattedBalance: evmDepositFormattedBalance,
    allowance: depositAllowance,
    approve: depositApprove,
    isApprovePending: isDepositApprovePending,
    isApproveSuccess: isDepositApproveSuccess,
    refetchBalance: refetchDepositBalance,
    isLoading: isEvmDepositBalanceLoading,
  } = useEvmToken({ token: usdcAddr, spender: ENV.DEPOSIT_MANAGER_ADDRESS });

  const evmRequestDeposit = useRequestDeposit();
  const evmClaim = useClaim();

  const plusdAddr = (plusdFromManager ?? ZERO_ADDRESS) as `0x${string}`;
  const {
    decimals: evmWithdrawDecimals,
    balance: evmWithdrawBalance,
    formattedBalance: evmWithdrawFormattedBalance,
    allowance: withdrawAllowance,
    approve: withdrawApprove,
    isApprovePending: isWithdrawApprovePending,
    isApproveSuccess: isWithdrawApproveSuccess,
    refetchBalance: refetchWithdrawBalance,
    isLoading: isEvmWithdrawBalanceLoading,
  } = useEvmToken({ token: plusdAddr, spender: ENV.WITHDRAWAL_QUEUE_ADDRESS });

  const evmRequestWithdrawal = useRequestWithdrawal();
  const evmClaimWithdrawal = useClaimWithdrawal();

  const { feeEth: depositFeeEth } = useNetworkFeeEstimate("deposit");
  const { feeEth: withdrawFeeEth } = useNetworkFeeEstimate("withdraw");

  // ── Stellar: connection + token hooks (called unconditionally) ─────────────
  const {
    address: stellarAddress,
    isConnected: isStellarConnected,
    connect: stellarConnect,
  } = useStellarWallet();

  const { addresses: stellarAddresses } = useStellarDepositManagerAddresses();

  // USDC balance — deposit input on Stellar.
  // Use the same source as the TopBar wallet pill (`useStellarToken`) so the
  // deposit page's balance check can never disagree with the balance shown in
  // the header. (The SAC hook reads a separate mock key / issuer and would
  // diverge — surfacing a false "Add funds" banner when the user holds USDC.)
  const usdcToken = useStellarToken();
  // PLUSD SAC — withdraw input on Stellar
  const plusdSac = useStellarSacToken({
    assetCode: "PLUSD",
    assetIssuer: stellarAddresses?.plusdAsset.issuer ?? "",
    contractId: stellarAddresses?.plusd ?? "",
  });

  const stellarRequestDeposit = useStellarRequestDeposit();
  const stellarClaim = useStellarClaim();
  const stellarRequestWithdrawal = useStellarRequestWithdrawal();
  const stellarClaimWithdrawal = useStellarClaimWithdrawal();

  const changeTrust = useChangeTrust(); // PLUSD trustline (deposit)
  const changeTrustUsdc = useStellarChangeTrustUsdc(); // USDC trustline (withdraw)

  const { feeXlm: depositFeeXlm } = useStellarNetworkFeeEstimate("deposit");
  const { feeXlm: withdrawFeeXlm } = useStellarNetworkFeeEstimate("withdraw");

  // ── Shared: useRequests (chain-aware — picks wallet address by view) ───────
  const { data: requestsData, isLoading: requestsLoading } = useRequests({ refetchInterval: 60_000 });

  // ── EVM request state machines ─────────────────────────────────────────────
  const evmDepositActiveRequest =
    requestsData?.requests
      .filter(
        (r) =>
          r.type === "Deposit" &&
          (r.status === "PendingVerification" || r.status === "PendingClaim"),
      )
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )[0] ?? null;

  const evmWithdrawActiveRequest =
    requestsData?.requests
      .filter(
        (r) =>
          r.type === "Withdraw" &&
          (r.status === "PendingVerification" || r.status === "PendingClaim"),
      )
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )[0] ?? null;

  const evmDepositRequestId: string | undefined =
    evmDepositActiveRequest?.request_id ?? evmRequestDeposit.data?.requestId;
  const evmWithdrawRequestId: string | undefined =
    evmWithdrawActiveRequest?.request_id ??
    evmRequestWithdrawal.data?.requestId;

  const evmDepositRequestIsConfirmed =
    evmDepositActiveRequest !== null ||
    (evmRequestDeposit.isSuccess && evmDepositRequestId !== undefined);
  const evmWithdrawRequestIsConfirmed =
    evmWithdrawActiveRequest !== null ||
    (evmRequestWithdrawal.isSuccess && evmWithdrawRequestId !== undefined);

  const evmDepositIsPendingClaim =
    evmDepositActiveRequest?.status === "PendingClaim";
  const evmDepositIsPendingVerification =
    evmDepositActiveRequest?.status === "PendingVerification";
  const evmWithdrawIsPendingClaim =
    evmWithdrawActiveRequest?.status === "PendingClaim";
  const evmWithdrawIsPendingVerification =
    evmWithdrawActiveRequest?.status === "PendingVerification";

  const evmDepositVoucherRequestId =
    !isStellar && evmDepositIsPendingClaim ? evmDepositRequestId : undefined;
  const evmWithdrawVoucherRequestId =
    !isStellar && evmWithdrawIsPendingClaim ? evmWithdrawRequestId : undefined;

  const evmDepositVoucher = useDepositVoucher(evmDepositVoucherRequestId);
  const evmWithdrawVoucher = useWithdrawalVoucher(evmWithdrawVoucherRequestId);

  // ── Stellar request state machines ─────────────────────────────────────────
  // On Stellar the API list may be empty until the backend sub-issue lands.
  // We drive steps from on-chain reads + localStorage in-flight recovery.
  const stellarDepositInflight = readInflightDeposit(stellarAddress ?? "");
  const stellarWithdrawInflight = readInflightWithdrawal(stellarAddress ?? "");

  // Extract from API (will be empty until backend sub-issue lands)
  const stellarDepositActiveRequest =
    requestsData?.requests
      .filter(
        (r) =>
          r.type === "Deposit" &&
          (r.status === "PendingVerification" || r.status === "PendingClaim"),
      )
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )[0] ?? null;

  const stellarWithdrawActiveRequest =
    requestsData?.requests
      .filter(
        (r) =>
          r.type === "Withdraw" &&
          (r.status === "PendingVerification" || r.status === "PendingClaim"),
      )
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )[0] ?? null;

  // Stellar request IDs — keep one canonical id source so voucher fetch,
  // on-chain polling, and claim submission cannot drift apart.
  const stellarDepositApiRequestIdBigInt = parseRequestId(
    stellarDepositActiveRequest?.request_id,
  );
  const stellarWithdrawApiRequestIdBigInt = parseRequestId(
    stellarWithdrawActiveRequest?.request_id,
  );

  const stellarDepositRequestIdBigInt: bigint | undefined =
    stellarDepositApiRequestIdBigInt ??
    stellarRequestDeposit.data?.requestId ??
    (stellarDepositInflight?.requestId !== undefined
      ? parseRequestId(stellarDepositInflight.requestId)
      : undefined);
  const stellarWithdrawRequestIdBigInt: bigint | undefined =
    stellarWithdrawApiRequestIdBigInt ??
    stellarRequestWithdrawal.data?.requestId ??
    (stellarWithdrawInflight?.requestId !== undefined
      ? parseRequestId(stellarWithdrawInflight.requestId)
      : undefined);

  const stellarDepositRequestIdStr: string | undefined =
    stellarDepositRequestIdBigInt !== undefined
      ? stellarDepositRequestIdBigInt.toString()
      : undefined;
  const stellarWithdrawRequestIdStr: string | undefined =
    stellarWithdrawRequestIdBigInt !== undefined
      ? stellarWithdrawRequestIdBigInt.toString()
      : undefined;

  // On-chain request reads — polls for claimed state
  const stellarDepositOnChainReq = useStellarDepositRequest(
    stellarDepositRequestIdBigInt,
  );
  const stellarWithdrawOnChainReq = useStellarWithdrawalRequest(
    stellarWithdrawRequestIdBigInt,
  );

  const stellarDepositRequestIsConfirmed =
    stellarDepositActiveRequest !== null ||
    stellarRequestDeposit.isSuccess ||
    stellarDepositInflight !== undefined;
  const stellarWithdrawRequestIsConfirmed =
    stellarWithdrawActiveRequest !== null ||
    stellarRequestWithdrawal.isSuccess ||
    stellarWithdrawInflight !== undefined;

  const stellarDepositIsPendingClaim =
    stellarDepositActiveRequest?.status === "PendingClaim" ||
    (stellarDepositRequestIsConfirmed &&
      stellarDepositOnChainReq.request !== undefined &&
      !stellarDepositOnChainReq.request.claimed);
  const stellarDepositIsPendingVerification =
    stellarDepositActiveRequest?.status === "PendingVerification" ||
    (stellarDepositRequestIsConfirmed &&
      stellarDepositOnChainReq.request === undefined);
  const stellarWithdrawIsPendingClaim =
    stellarWithdrawActiveRequest?.status === "PendingClaim" ||
    (stellarWithdrawRequestIsConfirmed &&
      stellarWithdrawOnChainReq.request !== undefined &&
      !stellarWithdrawOnChainReq.request.claimed);
  const stellarWithdrawIsPendingVerification =
    stellarWithdrawActiveRequest?.status === "PendingVerification" ||
    (stellarWithdrawRequestIsConfirmed &&
      stellarWithdrawOnChainReq.request === undefined);

  // Stellar vouchers
  const stellarDepositVoucherRequestId =
    isStellar && stellarDepositIsPendingClaim
      ? stellarDepositRequestIdStr
      : undefined;
  const stellarWithdrawVoucherRequestId =
    isStellar && stellarWithdrawIsPendingClaim
      ? stellarWithdrawRequestIdStr
      : undefined;

  const stellarDepositVoucher = useStellarDepositVoucher(
    stellarDepositVoucherRequestId,
  );
  const stellarWithdrawVoucher = useStellarWithdrawalVoucher(
    stellarWithdrawVoucherRequestId,
  );

  // ── EVM derived state ──────────────────────────────────────────────────────
  const evmDepositNeedsApproval =
    depositAllowance !== undefined &&
    amountBig > 0n &&
    depositAllowance < amountBig;
  const evmDepositMeetsMin =
    evmMinDeposit !== undefined && amountBig > 0n && amountBig >= evmMinDeposit;
  const evmCanWithdraw =
    evmWithdrawDecimals !== undefined &&
    evmWithdrawBalance !== undefined &&
    amountBig > 0n &&
    amountBig <= ((evmWithdrawBalance as bigint) ?? 0n);
  const evmWithdrawNeedsApproval =
    withdrawAllowance !== undefined &&
    amountBig > 0n &&
    withdrawAllowance < amountBig;
  const evmHasSufficientWithdrawAllowance =
    withdrawAllowance !== undefined &&
    amountBig > 0n &&
    withdrawAllowance >= amountBig;

  const isEvmDepositReady =
    evmDepositDecimals !== undefined &&
    evmDepositBalance !== undefined &&
    evmMinDeposit !== undefined;
  const isEvmWithdrawReady =
    evmWithdrawDecimals !== undefined && evmWithdrawBalance !== undefined;

  // ── Stellar derived state ──────────────────────────────────────────────────
  // Balance: convert Horizon decimal string to bigint at 7 dp
  const stellarUsdcBalanceRaw: bigint | undefined =
    isStellarConnected && usdcToken.balance !== undefined
      ? sacDisplayToRaw(usdcToken.balance)
      : undefined;
  const stellarPlusdBalanceRaw: bigint | undefined =
    isStellarConnected && plusdSac.balance !== undefined
      ? sacDisplayToRaw(plusdSac.balance)
      : undefined;

  const depositNeedsTrustline = changeTrust.needsTrustline;
  const withdrawNeedsTrustline = changeTrustUsdc.needsTrustline;
  // Both trustlines must be present before Confirm can proceed (per issue #604 Q3 answer).
  const bothTrustlinesReady = !depositNeedsTrustline && !withdrawNeedsTrustline;

  const stellarDepositMeetsMin =
    amountBig > 0n && amountBig >= STELLAR_MIN_DEPOSIT;
  const stellarCanWithdraw =
    stellarPlusdBalanceRaw !== undefined &&
    amountBig > 0n &&
    amountBig <= stellarPlusdBalanceRaw;
  const isStellarDepositReady =
    isStellarConnected && stellarUsdcBalanceRaw !== undefined;
  const isStellarWithdrawReady =
    isStellarConnected && stellarPlusdBalanceRaw !== undefined;

  // ── Quick-amount handlers ──────────────────────────────────────────────────
  // These need to be stable callbacks, so we compute them once with useCallback.
  // We use all needed deps from the closure above.

  const onEvmDepositQuickAmount = useCallback(
    (idx: number) => {
      if (isDeposit) {
        if (evmDepositDecimals === undefined) return;
        if (idx === 0 && evmMinDeposit !== undefined) {
          setAmountInput(
            formatUsdc(evmMinDeposit, evmDepositDecimals).replace(/,/g, ""),
          );
          return;
        }
        if (idx === 1) setAmountInput("5000");
        else if (idx === 2) setAmountInput("10000");
        else if (idx === 3 && evmDepositBalance !== undefined) {
          setAmountInput(
            formatUsdc(evmDepositBalance as bigint, evmDepositDecimals).replace(
              /,/g,
              "",
            ),
          );
        }
      } else {
        if (
          evmWithdrawDecimals === undefined ||
          evmWithdrawBalance === undefined
        )
          return;
        let next: bigint;
        if (idx === 0) next = ((evmWithdrawBalance as bigint) * 25n) / 100n;
        else if (idx === 1) next = (evmWithdrawBalance as bigint) / 2n;
        else if (idx === 2)
          next = ((evmWithdrawBalance as bigint) * 75n) / 100n;
        else if (idx === 3) next = evmWithdrawBalance as bigint;
        else return;
        setAmountInput(formatUsdc(next, evmWithdrawDecimals).replace(/,/g, ""));
      }
    },
    [
      isDeposit,
      evmDepositDecimals,
      evmDepositBalance,
      evmWithdrawDecimals,
      evmWithdrawBalance,
      evmMinDeposit,
      setAmountInput,
    ],
  );

  const onStellarQuickAmount = useCallback(
    (idx: number) => {
      if (isDeposit) {
        if (idx === 0) {
          setAmountInput(
            formatUsdc(STELLAR_MIN_DEPOSIT, SAC_DECIMALS).replace(/,/g, ""),
          );
          return;
        }
        if (idx === 1) setAmountInput("5000");
        else if (idx === 2) setAmountInput("10000");
        else if (idx === 3 && stellarUsdcBalanceRaw !== undefined) {
          setAmountInput(
            formatUsdc(stellarUsdcBalanceRaw, SAC_DECIMALS).replace(/,/g, ""),
          );
        }
      } else {
        if (stellarPlusdBalanceRaw === undefined) return;
        let next: bigint;
        if (idx === 0) next = (stellarPlusdBalanceRaw * 25n) / 100n;
        else if (idx === 1) next = stellarPlusdBalanceRaw / 2n;
        else if (idx === 2) next = (stellarPlusdBalanceRaw * 75n) / 100n;
        else if (idx === 3) next = stellarPlusdBalanceRaw;
        else return;
        setAmountInput(formatUsdc(next, SAC_DECIMALS).replace(/,/g, ""));
      }
    },
    [isDeposit, stellarUsdcBalanceRaw, stellarPlusdBalanceRaw, setAmountInput],
  );

  // ── Select the active state by chain ──────────────────────────────────────

  if (!isStellar) {
    // ── EVM path ────────────────────────────────────────────────────────────
    const evmDecimals = isDeposit ? evmDepositDecimals : evmWithdrawDecimals;
    const evmBalance = isDeposit
      ? (evmDepositBalance as bigint | undefined)
      : (evmWithdrawBalance as bigint | undefined);
    const evmFormattedBalance = isDeposit
      ? evmDepositFormattedBalance
      : evmWithdrawFormattedBalance;

    const isEvmReady = isDeposit ? isEvmDepositReady : isEvmWithdrawReady;
    const evmHasBalance: boolean | undefined = isDeposit
      ? isEvmDepositReady
        ? (evmDepositBalance as bigint) >= (evmMinDeposit as bigint)
        : undefined
      : isEvmWithdrawReady
        ? true
        : undefined;

    const evmMeetsMin = isDeposit
      ? evmDepositMeetsMin
      : (evmCanWithdraw ?? false);

    const evmActiveRequest = isDeposit
      ? evmDepositActiveRequest
      : evmWithdrawActiveRequest;
    const evmRequestId = isDeposit ? evmDepositRequestId : evmWithdrawRequestId;
    const evmRequestIsConfirmed = isDeposit
      ? evmDepositRequestIsConfirmed
      : evmWithdrawRequestIsConfirmed;
    const evmIsPendingVerification = isDeposit
      ? evmDepositIsPendingVerification
      : evmWithdrawIsPendingVerification;
    const evmVoucher = isDeposit ? evmDepositVoucher : evmWithdrawVoucher;

    // Step gates
    const canEvmApproveDeposit =
      isEvmConnected &&
      evmHasBalance === true &&
      evmDepositMeetsMin &&
      evmDepositNeedsApproval &&
      !isDepositApprovePending &&
      !evmDepositRequestIsConfirmed;
    const canEvmConfirmDeposit =
      isEvmConnected &&
      evmHasBalance === true &&
      evmDepositMeetsMin &&
      !evmDepositNeedsApproval &&
      !evmRequestDeposit.isPending &&
      !evmDepositRequestIsConfirmed;
    const canEvmClaimDeposit =
      isEvmConnected &&
      evmDepositRequestId !== undefined &&
      evmDepositVoucher.status === "ready" &&
      !evmClaim.isPending &&
      !evmClaim.isSuccess;

    const canEvmApproveWithdraw =
      isEvmConnected &&
      evmCanWithdraw &&
      evmWithdrawNeedsApproval &&
      !isWithdrawApprovePending &&
      !evmWithdrawRequestIsConfirmed;
    const canEvmConfirmWithdraw =
      isEvmConnected &&
      evmCanWithdraw &&
      evmHasSufficientWithdrawAllowance &&
      !evmRequestWithdrawal.isPending &&
      !evmWithdrawRequestIsConfirmed;
    const canEvmClaimWithdraw =
      isEvmConnected &&
      evmWithdrawRequestId !== undefined &&
      evmWithdrawVoucher.status === "ready" &&
      !evmClaimWithdrawal.isPending &&
      !evmClaimWithdrawal.isSuccess;

    const canEvmApprove = isDeposit
      ? canEvmApproveDeposit
      : canEvmApproveWithdraw;
    const canEvmConfirm = isDeposit
      ? canEvmConfirmDeposit
      : canEvmConfirmWithdraw;
    const canEvmClaim = isDeposit ? canEvmClaimDeposit : canEvmClaimWithdraw;

    // Step states
    const evmDepositStep1State: StepState =
      (!evmDepositNeedsApproval && amountBig > 0n && isEvmConnected) ||
      evmDepositRequestIsConfirmed
        ? "success"
        : "idle";
    const evmDepositStep2State: StepState =
      evmDepositIsPendingClaim || evmClaim.isSuccess ? "success" : "idle";
    const evmDepositStep3State: StepState = evmClaim.isSuccess
      ? "success"
      : "idle";

    const evmWithdrawStep1State: StepState =
      (evmHasSufficientWithdrawAllowance && isEvmConnected) ||
      evmWithdrawRequestIsConfirmed
        ? "success"
        : "idle";
    const evmWithdrawStep2State: StepState =
      evmWithdrawIsPendingClaim || evmClaimWithdrawal.isSuccess
        ? "success"
        : "idle";
    const evmWithdrawStep3State: StepState = evmClaimWithdrawal.isSuccess
      ? "success"
      : "idle";

    const evmStep1State = isDeposit
      ? evmDepositStep1State
      : evmWithdrawStep1State;
    const evmStep2State = isDeposit
      ? evmDepositStep2State
      : evmWithdrawStep2State;
    const evmStep3State = isDeposit
      ? evmDepositStep3State
      : evmWithdrawStep3State;

    const evmIsDepositInputFaded =
      isEvmConnected &&
      !evmDepositNeedsApproval &&
      amountBig > 0n &&
      !evmDepositRequestIsConfirmed;
    const evmIsWithdrawInputFaded =
      isEvmConnected &&
      evmHasSufficientWithdrawAllowance &&
      !evmWithdrawRequestIsConfirmed;
    const evmIsInputFaded = isDeposit
      ? evmIsDepositInputFaded
      : evmIsWithdrawInputFaded;

    const evmIsAnyTxInFlight =
      isDepositApprovePending ||
      evmRequestDeposit.isPending ||
      evmClaim.isPending ||
      isWithdrawApprovePending ||
      evmRequestWithdrawal.isPending ||
      evmClaimWithdrawal.isPending;

    const evmNetworkFee = isDeposit ? depositFeeEth : withdrawFeeEth;

    const evmMinChipLabel =
      evmMinDeposit !== undefined && evmDecimals !== undefined
        ? `${formatUsdcCurrencyCompact(evmMinDeposit, evmDecimals)} (Min)`
        : "Min";

    const evmActiveBalance = isDeposit ? evmDepositBalance : evmWithdrawBalance;
    const evmIsDataPending =
      (isDeposit ? isEvmDepositBalanceLoading : isEvmWithdrawBalanceLoading) ||
      requestsLoading ||
      (isEvmConnected && evmActiveBalance === undefined);

    return {
      isConnected: isEvmConnected,
      connect: evmConnect,
      address: evmAddress,
      decimals: evmDecimals,
      formattedBalance: evmFormattedBalance,
      balance: evmBalance,
      minDeposit: evmMinDeposit,
      minChipLabel: evmMinChipLabel,
      isReady: isEvmReady,
      hasBalance: evmHasBalance,
      meetsMin: evmMeetsMin,
      isDataPending: evmIsDataPending,
      isAmountLocked: evmActiveRequest !== null,
      lockedAmountRaw:
        evmActiveRequest !== null && evmDecimals !== undefined
          ? BigInt(evmActiveRequest.amount)
          : undefined,
      requestId: evmRequestId,
      requestIsConfirmed: evmRequestIsConfirmed,
      isPendingVerification: evmIsPendingVerification,
      step1: {
        label: isDeposit
          ? "Allow Pipeline to use USDC"
          : "Allow Pipeline to use PLUSD",
        actionLabel: "Approve",
        state: evmStep1State,
        loading: isDeposit ? isDepositApprovePending : isWithdrawApprovePending,
        disabled: !canEvmApprove,
        onAction: () => {
          const approve = isDeposit ? depositApprove : withdrawApprove;
          approve?.(amountBig);
        },
      },
      step2: {
        label: isDeposit ? "Confirm USDC transfer" : "Confirm PLUSD burn",
        actionLabel: "Confirm",
        state: evmStep2State,
        loading: isDeposit
          ? evmRequestDeposit.isPending ||
            evmDepositIsPendingVerification ||
            (evmRequestDeposit.isSuccess &&
              !evmDepositRequestIsConfirmed &&
              evmDepositActiveRequest === null) ||
            evmVoucher.status === "pending"
          : evmRequestWithdrawal.isPending ||
            evmWithdrawIsPendingVerification ||
            (evmRequestWithdrawal.isSuccess &&
              !evmWithdrawRequestIsConfirmed &&
              evmWithdrawActiveRequest === null) ||
            evmVoucher.status === "pending",
        disabled: !canEvmConfirm,
        onAction: () => {
          if (isDeposit) evmRequestDeposit.write(amountBig);
          else evmRequestWithdrawal.write(amountBig);
        },
      },
      step3: {
        label: isDeposit ? "Claim your PLUSD" : "Claim your USDC",
        actionLabel: "Claim",
        state: evmStep3State,
        loading: isDeposit ? evmClaim.isPending : evmClaimWithdrawal.isPending,
        disabled: !canEvmClaim,
        onAction: () => {
          if (evmRequestId === undefined || !evmVoucher.data?.signature) return;
          if (isDeposit) {
            evmClaim.write(
              BigInt(evmRequestId),
              evmVoucher.data.signature as `0x${string}`,
            );
          } else {
            evmClaimWithdrawal.write(
              BigInt(evmRequestId),
              evmVoucher.data.signature as `0x${string}`,
            );
          }
        },
      },
      step1Tx: {
        isPending: isDeposit
          ? isDepositApprovePending
          : isWithdrawApprovePending,
        isSuccess: isDeposit
          ? isDepositApproveSuccess
          : isWithdrawApproveSuccess,
        error: null,
      },
      step2Tx: {
        isPending: isDeposit
          ? evmRequestDeposit.isPending
          : evmRequestWithdrawal.isPending,
        isSuccess: isDeposit
          ? evmRequestDeposit.isSuccess
          : evmRequestWithdrawal.isSuccess,
        error: isDeposit ? evmRequestDeposit.error : evmRequestWithdrawal.error,
      },
      step3Tx: {
        isPending: isDeposit
          ? evmClaim.isPending
          : evmClaimWithdrawal.isPending,
        isSuccess: isDeposit
          ? evmClaim.isSuccess
          : evmClaimWithdrawal.isSuccess,
        error: isDeposit ? evmClaim.error : evmClaimWithdrawal.error,
      },
      isAnyTxInFlight: evmIsAnyTxInFlight,
      isInputFaded: evmIsInputFaded,
      networkFee: evmNetworkFee,
      refetchBalance: isDeposit
        ? refetchDepositBalance
        : refetchWithdrawBalance,
      onQuickAmount: onEvmDepositQuickAmount,
      trustlines: [],
    };
  }

  // ── Stellar path ─────────────────────────────────────────────────────────

  const stellarBalance = isDeposit
    ? stellarUsdcBalanceRaw
    : stellarPlusdBalanceRaw;

  const stellarFormattedBalance =
    stellarBalance !== undefined
      ? formatStellarBalance(stellarBalance, SAC_DECIMALS)
      : undefined;

  const isStellarReady = isDeposit
    ? isStellarDepositReady
    : isStellarWithdrawReady;

  const stellarHasBalance: boolean | undefined = isDeposit
    ? isStellarDepositReady
      ? (stellarUsdcBalanceRaw ?? 0n) >= STELLAR_MIN_DEPOSIT
      : undefined
    : isStellarWithdrawReady
      ? true
      : undefined;

  const stellarMeetsMin = isDeposit
    ? stellarDepositMeetsMin
    : (stellarCanWithdraw ?? false);

  const stellarRequestIsConfirmed = isDeposit
    ? stellarDepositRequestIsConfirmed
    : stellarWithdrawRequestIsConfirmed;
  const stellarRequestId = isDeposit
    ? stellarDepositRequestIdStr
    : stellarWithdrawRequestIdStr;
  const stellarRequestIdBigInt = isDeposit
    ? stellarDepositRequestIdBigInt
    : stellarWithdrawRequestIdBigInt;
  const stellarIsPendingVerification = isDeposit
    ? stellarDepositIsPendingVerification
    : stellarWithdrawIsPendingVerification;
  const stellarVoucher = isDeposit
    ? stellarDepositVoucher
    : stellarWithdrawVoucher;

  // Step 1 state (trustline)
  const stellarDepositStep1State: StepState =
    !depositNeedsTrustline &&
    (stellarDepositRequestIsConfirmed || (amountBig > 0n && isStellarConnected))
      ? "success"
      : "idle";
  const stellarWithdrawStep1State: StepState =
    !withdrawNeedsTrustline &&
    (stellarWithdrawRequestIsConfirmed ||
      (amountBig > 0n && isStellarConnected))
      ? "success"
      : "idle";
  const stellarStep1State = isDeposit
    ? stellarDepositStep1State
    : stellarWithdrawStep1State;

  // Step 2 state (request)
  const stellarDepositStep2State: StepState =
    stellarDepositIsPendingClaim || stellarClaim.isSuccess ? "success" : "idle";
  const stellarWithdrawStep2State: StepState =
    stellarWithdrawIsPendingClaim || stellarClaimWithdrawal.isSuccess
      ? "success"
      : "idle";
  const stellarStep2State = isDeposit
    ? stellarDepositStep2State
    : stellarWithdrawStep2State;

  // Step 3 state (claim)
  const stellarStep3State: StepState = isDeposit
    ? stellarClaim.isSuccess
      ? "success"
      : "idle"
    : stellarClaimWithdrawal.isSuccess
      ? "success"
      : "idle";

  // Step gates
  const canStellarStep1Deposit =
    isStellarConnected &&
    stellarDepositMeetsMin &&
    stellarHasBalance === true &&
    depositNeedsTrustline &&
    !changeTrust.isPending &&
    !stellarDepositRequestIsConfirmed;
  const canStellarStep1Withdraw =
    isStellarConnected &&
    stellarCanWithdraw &&
    withdrawNeedsTrustline &&
    !changeTrustUsdc.isPending &&
    !stellarWithdrawRequestIsConfirmed;
  const canStellarStep1 = isDeposit
    ? canStellarStep1Deposit
    : canStellarStep1Withdraw;

  const canStellarStep2Deposit =
    isStellarConnected &&
    stellarDepositMeetsMin &&
    stellarHasBalance === true &&
    bothTrustlinesReady &&
    !stellarRequestDeposit.isPending &&
    !stellarDepositRequestIsConfirmed;
  const canStellarStep2Withdraw =
    isStellarConnected &&
    stellarCanWithdraw &&
    bothTrustlinesReady &&
    !stellarRequestWithdrawal.isPending &&
    !stellarWithdrawRequestIsConfirmed;
  const canStellarStep2 = isDeposit
    ? canStellarStep2Deposit
    : canStellarStep2Withdraw;

  const canStellarStep3Deposit =
    isStellarConnected &&
    stellarDepositRequestIdStr !== undefined &&
    stellarVoucher.status === "ready" &&
    !stellarClaim.isPending &&
    !stellarClaim.isSuccess;
  const canStellarStep3Withdraw =
    isStellarConnected &&
    stellarWithdrawRequestIdStr !== undefined &&
    stellarVoucher.status === "ready" &&
    !stellarClaimWithdrawal.isPending &&
    !stellarClaimWithdrawal.isSuccess;
  const canStellarStep3 = isDeposit
    ? canStellarStep3Deposit
    : canStellarStep3Withdraw;

  // Loading / faded
  const stellarDepositInputFaded =
    isStellarConnected &&
    !depositNeedsTrustline &&
    amountBig > 0n &&
    !stellarDepositRequestIsConfirmed;
  const stellarWithdrawInputFaded =
    isStellarConnected &&
    !withdrawNeedsTrustline &&
    !stellarWithdrawRequestIsConfirmed &&
    amountBig > 0n;
  const stellarIsInputFaded = isDeposit
    ? stellarDepositInputFaded
    : stellarWithdrawInputFaded;

  const stellarIsAnyTxInFlight =
    changeTrust.isPending ||
    changeTrustUsdc.isPending ||
    stellarRequestDeposit.isPending ||
    stellarClaim.isPending ||
    stellarRequestWithdrawal.isPending ||
    stellarClaimWithdrawal.isPending;

  const stellarNetworkFee = isDeposit ? depositFeeXlm : withdrawFeeXlm;

  const stellarInflight = isDeposit
    ? stellarDepositInflight
    : stellarWithdrawInflight;

  const stellarStep2Loading = isDeposit
    ? stellarRequestDeposit.isPending ||
      stellarDepositIsPendingVerification ||
      (stellarRequestDeposit.isSuccess &&
        !stellarDepositRequestIsConfirmed &&
        stellarDepositActiveRequest === null) ||
      stellarVoucher.status === "pending"
    : stellarRequestWithdrawal.isPending ||
      stellarWithdrawIsPendingVerification ||
      (stellarRequestWithdrawal.isSuccess &&
        !stellarWithdrawRequestIsConfirmed &&
        stellarWithdrawActiveRequest === null) ||
      stellarVoucher.status === "pending";

  const stellarMinChipLabel = `${formatUsdcCurrencyCompact(STELLAR_MIN_DEPOSIT, SAC_DECIMALS)} (Min)`;

  const stellarActiveBalance = isDeposit ? stellarUsdcBalanceRaw : stellarPlusdBalanceRaw;
  const stellarIsDataPending =
    (isDeposit ? usdcToken.isLoading : plusdSac.isLoading) ||
    requestsLoading ||
    (isStellarConnected && stellarActiveBalance === undefined);

  return {
    isConnected: isStellarConnected,
    connect: stellarConnect,
    address: stellarAddress,
    decimals: SAC_DECIMALS,
    formattedBalance: stellarFormattedBalance,
    balance: stellarBalance,
    minDeposit: STELLAR_MIN_DEPOSIT,
    minChipLabel: stellarMinChipLabel,
    isReady: isStellarReady,
    hasBalance: stellarHasBalance,
    meetsMin: stellarMeetsMin,
    isDataPending: stellarIsDataPending,
    isAmountLocked: stellarRequestIsConfirmed,
    lockedAmountRaw:
      stellarInflight?.amount !== undefined
        ? BigInt(stellarInflight.amount)
        : undefined,
    requestId: stellarRequestId,
    requestIsConfirmed: stellarRequestIsConfirmed,
    isPendingVerification: stellarIsPendingVerification,
    step1: {
      label: isDeposit ? "Enable PLUSD" : "Enable USDC",
      actionLabel: "Enable",
      state: stellarStep1State,
      loading: isDeposit ? changeTrust.isPending : changeTrustUsdc.isPending,
      disabled: !canStellarStep1,
      onAction: () => {
        if (isDeposit) changeTrust.submit();
        else changeTrustUsdc.submit();
      },
    },
    step2: {
      label: isDeposit ? "Confirm USDC transfer" : "Confirm PLUSD burn",
      actionLabel: "Confirm",
      state: stellarStep2State,
      loading: stellarStep2Loading,
      disabled: !canStellarStep2,
      onAction: () => {
        if (isDeposit) stellarRequestDeposit.write(amountBig);
        else stellarRequestWithdrawal.write(amountBig);
      },
    },
    step3: {
      label: isDeposit ? "Claim your PLUSD" : "Claim your USDC",
      actionLabel: "Claim",
      state: stellarStep3State,
      loading: isDeposit ? stellarClaim.isPending : stellarClaimWithdrawal.isPending,
      disabled: !canStellarStep3,
      onAction: () => {
        if (stellarRequestIdBigInt === undefined) return;
        const sig =
          stellarVoucher.status === "ready"
            ? (stellarVoucher as { signatureBytes?: Uint8Array }).signatureBytes
            : undefined;
        if (!sig) return;
        if (isDeposit) {
          stellarClaim.write(stellarRequestIdBigInt, sig);
        } else {
          stellarClaimWithdrawal.write(stellarRequestIdBigInt, sig);
        }
      },
    },
    step1Tx: {
      isPending: isDeposit ? changeTrust.isPending : changeTrustUsdc.isPending,
      isSuccess: isDeposit ? changeTrust.isSuccess : changeTrustUsdc.isSuccess,
      error: isDeposit ? changeTrust.error : changeTrustUsdc.error,
    },
    step2Tx: {
      isPending: isDeposit
        ? stellarRequestDeposit.isPending
        : stellarRequestWithdrawal.isPending,
      isSuccess: isDeposit
        ? stellarRequestDeposit.isSuccess
        : stellarRequestWithdrawal.isSuccess,
      error: isDeposit
        ? stellarRequestDeposit.error
        : stellarRequestWithdrawal.error,
    },
    step3Tx: {
      isPending: isDeposit
        ? stellarClaim.isPending
        : stellarClaimWithdrawal.isPending,
      isSuccess: isDeposit
        ? stellarClaim.isSuccess
        : stellarClaimWithdrawal.isSuccess,
      error: isDeposit ? stellarClaim.error : stellarClaimWithdrawal.error,
    },
    isAnyTxInFlight: stellarIsAnyTxInFlight,
    isInputFaded: stellarIsInputFaded,
    networkFee: stellarNetworkFee,
    refetchBalance: isDeposit
      ? usdcToken.refetchBalance
      : plusdSac.refetchBalance,
    onQuickAmount: onStellarQuickAmount,
    trustlines: [
      {
        asset: "PLUSD" as const,
        needsTrustline: depositNeedsTrustline,
        isEnabled: !depositNeedsTrustline,
        enabling: changeTrust.isPending,
        error: changeTrust.error,
        onEnable: () => changeTrust.submit(),
        tx: {
          isPending: changeTrust.isPending,
          isSuccess: changeTrust.isSuccess,
          error: changeTrust.error,
        },
      },
      {
        asset: "USDC" as const,
        needsTrustline: withdrawNeedsTrustline,
        isEnabled: !withdrawNeedsTrustline,
        enabling: changeTrustUsdc.isPending,
        error: changeTrustUsdc.error,
        onEnable: () => changeTrustUsdc.submit(),
        tx: {
          isPending: changeTrustUsdc.isPending,
          isSuccess: changeTrustUsdc.isSuccess,
          error: changeTrustUsdc.error,
        },
      },
    ],
  };
}
