/**
 * Chain-agnostic deposit/withdraw flow adapter — exposes a unified `FlowState`
 * so the deposit/withdraw route consumes one shape instead of chain-specific hooks.
 *
 * spec: docs/frontend/wallet-flows.md#deposit--withdraw-adapter-usedepositflow
 * (architecture, FlowState contract, business rules, request state model, step model).
 */

import { useCallback, useEffect, useRef } from "react";
import {
  useWalletView,
  // EVM
  useEvmWallet,
  useEvmNetworkGuard,
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
  useStellarDepositManagerMinDeposit,
  useStellarSacToken,
  useStellarToken,
  useStellarXlmBalance,
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
  clearInflightDeposit,
  clearInflightWithdrawal,
  readInflightEvmRequest,
  clearInflightEvmRequest,
  useStellarNetworkFeeEstimate,
} from "@/wallet";
import type { WrongNetworkInfo } from "@/wallet";
import {
  useRequests,
  useInvalidateRequests,
  useDepositVoucher,
  useWithdrawalVoucher,
  useStellarDepositVoucher,
  useStellarWithdrawalVoucher,
} from "@/api";
import { ENV } from "@/lib/env";
import { formatTokenAmount } from "@/lib/format";
import { formatUnits } from "./evm/units";
import {
  isRecoveryRateActive,
  useWithdrawalQueueTotals,
  useWithdrawalRequestQueueState,
} from "./useWithdrawalQueueReads";
import { useStellarClaimPayout } from "./stellar/useStellarWithdrawalQueueReads";
import { useEvmClaimPayout } from "./evm/useEvmWithdrawalQueueReads";
import {
  selectWithdrawClaimHint,
  WITHDRAW_REQUEST_HINT,
} from "./withdrawClaimHint";
import { formatUsdcCurrencyCompact, formatUsdcInput } from "@/lib/usdc";
import { balanceChipAmount } from "@/utils/quickAmount";
import {
  parseSorobanContractErrorCode,
  SOROBAN_VOUCHER_EXPIRED_CODE,
  toUserError,
  type UserFacingError,
} from "@/utils/userError";

// ── Types ─────────────────────────────────────────────────────────────────────

export type Direction = "deposit" | "withdraw";

/** spec: docs/frontend/wallet-flows.md#step-error-state */
export type StepState = "idle" | "success" | "error";

export interface StepInfo {
  label: string;
  actionLabel: string;
  state: StepState;
  loading: boolean;
  disabled: boolean;
  onAction: () => void;
  /**
   * Set only when `state` is `"error"` — the step row's mapped, human-safe
   * message line (never the raw error text). spec:
   * docs/frontend/error-handling.md
   */
  errorMessage?: string;
  /**
   * Raw error text for the details dialog — never rendered inline. Set
   * alongside `errorMessage` when `state` is `"error"`.
   */
  errorDetails?: string;
  hint?: string;
}

export interface WithdrawQueueInfo {
  requestAmount: bigint | undefined;
  position: bigint | undefined;
  payableNow: boolean | undefined;
  rateRaw: bigint | undefined;
  rateDecimals: number | undefined;
  recoveryActive: boolean;
  payout: bigint | undefined;
  plusdDecimals: number | undefined;
  usdcDecimals: number | undefined;
}

/** Per-step write transaction state — used by the component for toast emission. */
export interface StepTxState {
  isPending: boolean;
  isSuccess: boolean;
  error: Error | null;
  /**
   * The mapped form of `error` (`toUserError`) — lets callers (e.g. toast
   * effects) read the mapped copy without re-mapping at the call site.
   * `undefined` while `error` is null.
   */
  userError?: UserFacingError;
}

/**
 * Per-asset Stellar trustline descriptor. (`FlowState.trustlines` array invariant:
 * spec: docs/frontend/wallet-flows.md#design-choices--invariants.)
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
  plusdAuthorized: boolean | undefined;

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
  exceedsBalance: boolean;
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

  // ── Completed (claimed) deposit reset signal ──────────────────────────
  /**
   * True (deposit direction only) when the latest deposit has settled to
   * `Completed` and not been dismissed — the page resets the form. Fires once
   * per completed deposit. spec: docs/frontend/wallet-flows.md#request-state-model.
   */
  isDepositCompleted: boolean;
  /** `request_id` of the completed deposit that triggered the reset (for dismissal). */
  depositCompletedRequestId: string | undefined;

  /**
   * Resets the active-direction request/claim mutations to their initial state.
   * Called (with an input clear) when a deposit settles to `Completed` so the
   * form returns to its initial state instead of staying pinned on success.
   */
  reset: () => void;

  // ── Steps ──────────────────────────────────────────────────────────────
  step1: StepInfo;
  step2: StepInfo;
  step3: StepInfo;

  withdrawQueue: WithdrawQueueInfo | undefined;

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

  needsXlmFunding: boolean;

  wrongNetwork: WrongNetworkInfo | undefined;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const REQUESTS_POLL_MS = 60_000;
const REQUESTS_FAST_POLL_MS = 5_000;

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
 * @param dismissedDepositRequestId - `request_id` of a `Completed` deposit the
 *   page has already reacted to. When it matches the latest completed deposit,
 *   `isDepositCompleted` is suppressed so the reset fires only once.
 */
export function useDepositFlow(
  direction: Direction,
  amountBig: bigint,
  setAmountInput: (v: string) => void,
  dismissedDepositRequestId?: string,
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
    approveError: depositApproveError,
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
    approveError: withdrawApproveError,
  } = useEvmToken({ token: plusdAddr, spender: ENV.WITHDRAWAL_QUEUE_ADDRESS });

  const evmRequestWithdrawal = useRequestWithdrawal();
  const evmClaimWithdrawal = useClaimWithdrawal();

  const { wrongNetwork } = useEvmNetworkGuard();

  const { feeEth: depositFeeEth } = useNetworkFeeEstimate("deposit");
  const { feeEth: withdrawFeeEth } = useNetworkFeeEstimate("withdraw");

  // ── Stellar: connection + token hooks (called unconditionally) ─────────────
  const {
    address: stellarAddress,
    isConnected: isStellarConnected,
    connect: stellarConnect,
  } = useStellarWallet();

  const { addresses: stellarAddresses } = useStellarDepositManagerAddresses();
  const { minDeposit: stellarMinDeposit } =
    useStellarDepositManagerMinDeposit();

  // USDC balance (Stellar deposit input) via the same source as the TopBar pill
  // so the two can't disagree. spec: docs/frontend/wallet-flows.md#design-choices--invariants.
  const usdcToken = useStellarToken();
  const xlm = useStellarXlmBalance();
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

  // ── In-flight recovery records (reload guard) ──────────────────────────────
  const stellarDepositInflight = readInflightDeposit(stellarAddress ?? "");
  const stellarWithdrawInflight = readInflightWithdrawal(stellarAddress ?? "");
  const evmDepositInflight = evmAddress
    ? readInflightEvmRequest("deposit", ENV.EVM_CHAIN_ID, evmAddress)
    : undefined;
  const evmWithdrawInflight = evmAddress
    ? readInflightEvmRequest("withdraw", ENV.EVM_CHAIN_ID, evmAddress)
    : undefined;

  const knownPendingIds: { type: "Deposit" | "Withdraw"; id: string }[] = [];
  const addKnownId = (type: "Deposit" | "Withdraw", id: unknown) => {
    if (id !== undefined && id !== null)
      knownPendingIds.push({ type, id: String(id) });
  };
  if (isStellar) {
    addKnownId("Deposit", stellarRequestDeposit.data?.requestId);
    addKnownId("Deposit", stellarDepositInflight?.requestId);
    addKnownId("Withdraw", stellarRequestWithdrawal.data?.requestId);
    addKnownId("Withdraw", stellarWithdrawInflight?.requestId);
  } else {
    addKnownId("Deposit", evmRequestDeposit.data?.requestId);
    addKnownId("Deposit", evmDepositInflight?.requestId);
    addKnownId("Withdraw", evmRequestWithdrawal.data?.requestId);
    addKnownId("Withdraw", evmWithdrawInflight?.requestId);
  }

  // ── Shared: useRequests (chain-aware — picks wallet address by view) ───────
  const { data: requestsData, isLoading: requestsLoading } = useRequests({
    refetchInterval: (data) =>
      knownPendingIds.some(
        (k) =>
          !data?.requests.some(
            (r) => r.type === k.type && r.request_id === k.id,
          ),
      )
        ? REQUESTS_FAST_POLL_MS
        : REQUESTS_POLL_MS,
  });
  const invalidateRequests = useInvalidateRequests();

  const isRequestListed = (
    type: "Deposit" | "Withdraw",
    id: string | undefined,
  ) =>
    id !== undefined &&
    (requestsData?.requests.some(
      (r) => r.type === type && r.request_id === id,
    ) ??
      false);

  useEffect(() => {
    if (evmRequestDeposit.isSuccess) invalidateRequests();
  }, [evmRequestDeposit.isSuccess, invalidateRequests]);
  useEffect(() => {
    if (evmRequestWithdrawal.isSuccess) invalidateRequests();
  }, [evmRequestWithdrawal.isSuccess, invalidateRequests]);
  useEffect(() => {
    if (stellarRequestDeposit.isSuccess) invalidateRequests();
  }, [stellarRequestDeposit.isSuccess, invalidateRequests]);
  useEffect(() => {
    if (stellarRequestWithdrawal.isSuccess) invalidateRequests();
  }, [stellarRequestWithdrawal.isSuccess, invalidateRequests]);

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

  const evmDepositInflightListed =
    evmDepositInflight !== undefined &&
    isRequestListed("Deposit", evmDepositInflight.requestId);
  const evmWithdrawInflightListed =
    evmWithdrawInflight !== undefined &&
    isRequestListed("Withdraw", evmWithdrawInflight.requestId);
  const evmDepositInflightActive =
    evmDepositInflight !== undefined && !evmDepositInflightListed;
  const evmWithdrawInflightActive =
    evmWithdrawInflight !== undefined && !evmWithdrawInflightListed;

  useEffect(() => {
    if (evmAddress && evmDepositInflightListed) {
      clearInflightEvmRequest("deposit", ENV.EVM_CHAIN_ID, evmAddress);
    }
  }, [evmAddress, evmDepositInflightListed]);
  useEffect(() => {
    if (evmAddress && evmWithdrawInflightListed) {
      clearInflightEvmRequest("withdraw", ENV.EVM_CHAIN_ID, evmAddress);
    }
  }, [evmAddress, evmWithdrawInflightListed]);
  useEffect(() => {
    if (evmAddress && evmClaim.isSuccess) {
      clearInflightEvmRequest("deposit", ENV.EVM_CHAIN_ID, evmAddress);
    }
  }, [evmAddress, evmClaim.isSuccess]);
  useEffect(() => {
    if (evmAddress && evmClaimWithdrawal.isSuccess) {
      clearInflightEvmRequest("withdraw", ENV.EVM_CHAIN_ID, evmAddress);
    }
  }, [evmAddress, evmClaimWithdrawal.isSuccess]);

  const evmDepositRequestId: string | undefined =
    evmDepositActiveRequest?.request_id ??
    evmRequestDeposit.data?.requestId ??
    (evmDepositInflightActive ? evmDepositInflight?.requestId : undefined);
  const evmWithdrawRequestId: string | undefined =
    evmWithdrawActiveRequest?.request_id ??
    evmRequestWithdrawal.data?.requestId ??
    (evmWithdrawInflightActive ? evmWithdrawInflight?.requestId : undefined);

  const evmDepositRequestIsConfirmed =
    evmDepositActiveRequest !== null ||
    (evmRequestDeposit.isSuccess && evmDepositRequestId !== undefined) ||
    evmDepositInflightActive;

  // Most-recent claimed deposit. The active-request filter above keeps only
  // `PendingVerification`/`PendingClaim`, so a claimed request settles to
  // `Completed` and drops out of that set. We track it separately so the page
  // can reset the form once the deposit settles (waiting for the active request
  // to clear avoids re-enabling Claim during the API's PendingClaim lag).
  const evmDepositCompletedRequest =
    requestsData?.requests
      .filter((r) => r.type === "Deposit" && r.status === "Completed")
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )[0] ?? null;

  // Reset signal: the latest deposit is `Completed` (no newer Pending* request)
  // and the page has not yet reacted to it.
  const evmDepositIsCompleted =
    evmDepositActiveRequest === null &&
    evmDepositCompletedRequest !== null &&
    evmDepositCompletedRequest.request_id !== dismissedDepositRequestId;

  const evmWithdrawRequestIsConfirmed =
    evmWithdrawActiveRequest !== null ||
    (evmRequestWithdrawal.isSuccess && evmWithdrawRequestId !== undefined) ||
    evmWithdrawInflightActive;

  const evmDepositAwaitingIndexer =
    evmDepositRequestIsConfirmed &&
    evmDepositActiveRequest === null &&
    !isRequestListed("Deposit", evmDepositRequestId);
  const evmWithdrawAwaitingIndexer =
    evmWithdrawRequestIsConfirmed &&
    evmWithdrawActiveRequest === null &&
    !isRequestListed("Withdraw", evmWithdrawRequestId);

  const evmDepositIsPendingClaim =
    evmDepositActiveRequest?.status === "PendingClaim";
  const evmDepositIsPendingVerification =
    evmDepositActiveRequest?.status === "PendingVerification" ||
    evmDepositAwaitingIndexer;
  const evmWithdrawIsPendingClaim =
    evmWithdrawActiveRequest?.status === "PendingClaim";
  const evmWithdrawIsPendingVerification =
    evmWithdrawActiveRequest?.status === "PendingVerification" ||
    evmWithdrawAwaitingIndexer;

  const evmDepositVoucherRequestId =
    !isStellar && evmDepositIsPendingClaim ? evmDepositRequestId : undefined;
  const evmWithdrawVoucherRequestId =
    !isStellar && evmWithdrawIsPendingClaim ? evmWithdrawRequestId : undefined;

  const evmDepositVoucher = useDepositVoucher(evmDepositVoucherRequestId);
  const evmWithdrawVoucher = useWithdrawalVoucher(evmWithdrawVoucherRequestId);

  // ── Stellar request state machines ─────────────────────────────────────────
  // On Stellar the API list may be empty until the backend sub-issue lands.
  // We drive steps from on-chain reads + localStorage in-flight recovery.
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

  // Most-recent claimed deposit (settled to `Completed`). Tracked separately so
  // the page can reset the form once the claimed request drops out of the active
  // set (waiting for that avoids re-enabling Claim during the PendingClaim lag).
  const stellarDepositCompletedRequest =
    requestsData?.requests
      .filter((r) => r.type === "Deposit" && r.status === "Completed")
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )[0] ?? null;

  // Reset signal: the latest deposit is `Completed` (no newer Pending* request)
  // and the page has not yet reacted to it.
  const stellarDepositIsCompleted =
    stellarDepositActiveRequest === null &&
    stellarDepositCompletedRequest !== null &&
    stellarDepositCompletedRequest.request_id !== dismissedDepositRequestId;

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

  // ── Reconcile stale in-flight records against on-chain claimed state ───────
  // Drop a lingering localStorage in-flight record once the request reads back as
  // claimed on-chain, so it can't pin the form as "confirmed" forever.
  // spec: docs/frontend/wallet-flows.md#request-state-model.
  const stellarDepositClaimedOnChain =
    stellarDepositOnChainReq.request?.claimed === true;
  const stellarWithdrawClaimedOnChain =
    stellarWithdrawOnChainReq.request?.claimed === true;

  const stellarDepositInflightActive =
    stellarDepositInflight !== undefined && !stellarDepositClaimedOnChain;
  const stellarWithdrawInflightActive =
    stellarWithdrawInflight !== undefined && !stellarWithdrawClaimedOnChain;

  // Housekeeping: physically remove the dead localStorage key. The UI already
  // ignores it this render via `*InflightActive`, so correctness does not depend
  // on this effect firing — it just stops the key from lingering.
  useEffect(() => {
    if (
      stellarAddress &&
      stellarDepositInflight !== undefined &&
      stellarDepositClaimedOnChain
    ) {
      clearInflightDeposit(stellarAddress);
    }
  }, [stellarAddress, stellarDepositInflight, stellarDepositClaimedOnChain]);
  useEffect(() => {
    if (
      stellarAddress &&
      stellarWithdrawInflight !== undefined &&
      stellarWithdrawClaimedOnChain
    ) {
      clearInflightWithdrawal(stellarAddress);
    }
  }, [stellarAddress, stellarWithdrawInflight, stellarWithdrawClaimedOnChain]);

  const stellarDepositRequestIsConfirmed =
    stellarDepositActiveRequest !== null ||
    stellarRequestDeposit.isSuccess ||
    stellarDepositInflightActive;
  const stellarWithdrawRequestIsConfirmed =
    stellarWithdrawActiveRequest !== null ||
    stellarRequestWithdrawal.isSuccess ||
    stellarWithdrawInflightActive;

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

  const voucherRetriedRef = useRef<Set<string>>(new Set());
  const claimVoucherRequestId = isDeposit
    ? stellarDepositVoucherRequestId
    : stellarWithdrawVoucherRequestId;
  const claimVoucherError = isDeposit
    ? stellarClaim.error
    : stellarClaimWithdrawal.error;
  const invalidateClaimVoucher = isDeposit
    ? stellarDepositVoucher.invalidate
    : stellarWithdrawVoucher.invalidate;
  const resetClaim = isDeposit
    ? stellarClaim.reset
    : stellarClaimWithdrawal.reset;
  useEffect(() => {
    if (!claimVoucherError || claimVoucherRequestId === undefined) return;
    if (
      parseSorobanContractErrorCode(toUserError(claimVoucherError).details) !==
      SOROBAN_VOUCHER_EXPIRED_CODE
    ) {
      return;
    }
    const key = `${isDeposit ? "deposit" : "withdraw"}:${claimVoucherRequestId}`;
    if (voucherRetriedRef.current.has(key)) return;
    voucherRetriedRef.current.add(key);
    invalidateClaimVoucher();
    resetClaim();
  }, [
    claimVoucherError,
    claimVoucherRequestId,
    isDeposit,
    invalidateClaimVoucher,
    resetClaim,
  ]);

  // ── Withdraw queue reads (position, payable now, rate, payout) ─────────────
  const isWithdraw = !isDeposit;
  const withdrawQueueRequestId: bigint | undefined = isStellar
    ? stellarWithdrawRequestIdBigInt
    : parseRequestId(evmWithdrawRequestId);
  const queueTotals = useWithdrawalQueueTotals(kind, isWithdraw);
  const queueRequestState = useWithdrawalRequestQueueState(
    kind,
    withdrawQueueRequestId,
    isWithdraw,
  );
  const recoveryActive = isRecoveryRateActive(queueTotals);
  const payoutEnabled =
    isWithdraw && queueRequestState.payableNow === true && recoveryActive;
  const stellarWithdrawDeadlineRaw = stellarWithdrawVoucher.data?.deadline;
  const stellarPayout = useStellarClaimPayout({
    requestId: stellarWithdrawRequestIdBigInt,
    signatureBytes: stellarWithdrawVoucher.signatureBytes,
    deadline:
      stellarWithdrawDeadlineRaw !== undefined &&
      /^\d+$/.test(stellarWithdrawDeadlineRaw)
        ? BigInt(stellarWithdrawDeadlineRaw)
        : undefined,
    sender: stellarAddress,
    enabled: payoutEnabled && isStellar,
  });
  const evmWithdrawAmountRaw: bigint | undefined =
    evmWithdrawActiveRequest !== null
      ? BigInt(evmWithdrawActiveRequest.amount)
      : evmWithdrawInflight !== undefined
        ? BigInt(evmWithdrawInflight.amount)
        : undefined;
  const evmPayout = useEvmClaimPayout(evmWithdrawAmountRaw, {
    enabled: payoutEnabled && !isStellar,
  });
  const queuePayout = isStellar ? stellarPayout.data : evmPayout.data;

  const queueAmountRaw: bigint | undefined = isStellar
    ? stellarWithdrawActiveRequest?.amount !== undefined
      ? BigInt(stellarWithdrawActiveRequest.amount)
      : stellarWithdrawInflight?.amount !== undefined
        ? BigInt(stellarWithdrawInflight.amount)
        : undefined
    : evmWithdrawAmountRaw;
  const queueRateText =
    queueTotals.rateRaw !== undefined && queueTotals.rateDecimals !== undefined
      ? formatUnits(queueTotals.rateRaw, queueTotals.rateDecimals)
      : undefined;
  const queueVoucher = isStellar ? stellarWithdrawVoucher : evmWithdrawVoucher;
  const queueClaimHint =
    isWithdraw && withdrawQueueRequestId !== undefined
      ? selectWithdrawClaimHint({
          paused: queueTotals.paused,
          voucherExpired: queueVoucher.expired,
          hasVoucher: queueVoucher.status === "ready",
          requestStatus: isStellar
            ? stellarWithdrawActiveRequest?.status
            : evmWithdrawActiveRequest?.status,
          payableNow: queueRequestState.payableNow,
          recoveryActive,
          payout:
            queuePayout !== undefined
              ? formatTokenAmount(queuePayout, queueTotals.usdcDecimals)
              : undefined,
          amount:
            queueAmountRaw !== undefined
              ? formatTokenAmount(queueAmountRaw, queueTotals.plusdDecimals)
              : undefined,
          rate: queueRateText,
        })
      : undefined;
  const queueClaimBlocked =
    isWithdraw &&
    (queueRequestState.payableNow === false || queueTotals.paused === true);
  const withdrawQueue: WithdrawQueueInfo | undefined = isWithdraw
    ? {
        requestAmount: queueAmountRaw,
        position: queueRequestState.position,
        payableNow: queueRequestState.payableNow,
        rateRaw: queueTotals.rateRaw,
        rateDecimals: queueTotals.rateDecimals,
        recoveryActive,
        payout: queuePayout,
        plusdDecimals: queueTotals.plusdDecimals,
        usdcDecimals: queueTotals.usdcDecimals,
      }
    : undefined;

  // ── EVM derived state ──────────────────────────────────────────────────────
  const evmDepositNeedsApproval =
    depositAllowance !== undefined &&
    amountBig > 0n &&
    depositAllowance < amountBig;
  const evmDepositMeetsMin =
    evmMinDeposit !== undefined &&
    evmDepositBalance !== undefined &&
    amountBig > 0n &&
    amountBig >= evmMinDeposit &&
    amountBig <= (evmDepositBalance as bigint);
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

  const stellarNeedsXlmFunding =
    isStellarConnected &&
    (xlm.accountExists === false ||
      (xlm.xlmBalance !== undefined && sacDisplayToRaw(xlm.xlmBalance) === 0n));

  const depositNeedsTrustline = changeTrust.needsTrustline;
  const withdrawNeedsTrustline = changeTrustUsdc.needsTrustline;
  // Both trustlines must be present before Confirm can proceed (per issue #604 Q3 answer).
  const bothTrustlinesReady = !depositNeedsTrustline && !withdrawNeedsTrustline;

  const stellarDepositMeetsMin =
    stellarMinDeposit !== undefined &&
    stellarUsdcBalanceRaw !== undefined &&
    amountBig > 0n &&
    amountBig >= stellarMinDeposit &&
    amountBig <= stellarUsdcBalanceRaw;
  const stellarCanWithdraw =
    stellarPlusdBalanceRaw !== undefined &&
    amountBig > 0n &&
    amountBig <= stellarPlusdBalanceRaw;
  const isStellarDepositReady =
    isStellarConnected &&
    stellarUsdcBalanceRaw !== undefined &&
    stellarMinDeposit !== undefined;
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
          setAmountInput(formatUsdcInput(evmMinDeposit, evmDepositDecimals));
          return;
        }
        if (idx === 1) setAmountInput("5000");
        else if (idx === 2) setAmountInput("10000");
        else if (idx === 3 && evmDepositBalance !== undefined) {
          setAmountInput(
            formatUsdcInput(evmDepositBalance as bigint, evmDepositDecimals),
          );
        }
      } else {
        if (
          evmWithdrawDecimals === undefined ||
          evmWithdrawBalance === undefined
        )
          return;
        const next = balanceChipAmount(evmWithdrawBalance as bigint, idx);
        if (next === undefined) return;
        setAmountInput(formatUsdcInput(next, evmWithdrawDecimals));
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
          if (stellarMinDeposit !== undefined) {
            setAmountInput(formatUsdcInput(stellarMinDeposit, SAC_DECIMALS));
          }
          return;
        }
        if (idx === 1) setAmountInput("5000");
        else if (idx === 2) setAmountInput("10000");
        else if (idx === 3 && stellarUsdcBalanceRaw !== undefined) {
          setAmountInput(formatUsdcInput(stellarUsdcBalanceRaw, SAC_DECIMALS));
        }
      } else {
        if (stellarPlusdBalanceRaw === undefined) return;
        const next = balanceChipAmount(stellarPlusdBalanceRaw, idx);
        if (next === undefined) return;
        setAmountInput(formatUsdcInput(next, SAC_DECIMALS));
      }
    },
    [
      isDeposit,
      stellarMinDeposit,
      stellarUsdcBalanceRaw,
      stellarPlusdBalanceRaw,
      setAmountInput,
    ],
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
    const evmAwaitingIndexer = isDeposit
      ? evmDepositAwaitingIndexer
      : evmWithdrawAwaitingIndexer;
    const evmInflight = isDeposit ? evmDepositInflight : evmWithdrawInflight;
    const evmLockedAmountRaw: bigint | undefined =
      evmActiveRequest !== null
        ? BigInt(evmActiveRequest.amount)
        : evmAwaitingIndexer && evmInflight !== undefined
          ? BigInt(evmInflight.amount)
          : undefined;

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

    // Step states.
    const evmStep1Error = isDeposit
      ? depositApproveError
      : withdrawApproveError;
    const evmStep1UserError = evmStep1Error
      ? toUserError(evmStep1Error)
      : undefined;
    const evmStep1ApprovePending = isDeposit
      ? isDepositApprovePending
      : isWithdrawApprovePending;
    const evmStep1ErrorState: StepState =
      evmStep1Error && !evmStep1ApprovePending ? "error" : "idle";

    const evmDepositStep1State: StepState =
      (!evmDepositNeedsApproval && amountBig > 0n && isEvmConnected) ||
      evmDepositRequestIsConfirmed
        ? "success"
        : evmStep1ErrorState;
    const evmDepositStep2State: StepState =
      evmDepositIsPendingClaim || evmClaim.isSuccess
        ? "success"
        : evmRequestDeposit.error && !evmRequestDeposit.isPending
          ? "error"
          : "idle";
    const evmDepositStep3State: StepState = evmClaim.isSuccess
      ? "success"
      : evmClaim.error && !evmClaim.isPending
        ? "error"
        : "idle";

    const evmWithdrawStep1State: StepState =
      (evmHasSufficientWithdrawAllowance && isEvmConnected) ||
      evmWithdrawRequestIsConfirmed
        ? "success"
        : evmStep1ErrorState;
    const evmWithdrawStep2State: StepState =
      evmWithdrawIsPendingClaim || evmClaimWithdrawal.isSuccess
        ? "success"
        : evmRequestWithdrawal.error && !evmRequestWithdrawal.isPending
          ? "error"
          : "idle";
    const evmWithdrawStep3State: StepState = evmClaimWithdrawal.isSuccess
      ? "success"
      : evmClaimWithdrawal.error && !evmClaimWithdrawal.isPending
        ? "error"
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

    // Mapped errors (#1034) — computed once so `errorMessage`/`errorDetails`
    // and `stepNTx.userError` don't each re-map. spec:
    // docs/frontend/error-handling.md
    const evmStep2Error = isDeposit
      ? evmRequestDeposit.error
      : evmRequestWithdrawal.error;
    const evmStep2UserError = evmStep2Error
      ? toUserError(evmStep2Error)
      : undefined;
    const evmStep3Error = isDeposit ? evmClaim.error : evmClaimWithdrawal.error;
    const evmStep3UserError = evmStep3Error
      ? toUserError(
          evmStep3Error,
          isDeposit ? undefined : { context: "withdrawClaim" },
        )
      : undefined;

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
      plusdAuthorized: undefined,
      minDeposit: evmMinDeposit,
      minChipLabel: evmMinChipLabel,
      isReady: isEvmReady,
      hasBalance: evmHasBalance,
      meetsMin: evmMeetsMin,
      exceedsBalance:
        evmActiveRequest === null &&
        !evmAwaitingIndexer &&
        evmBalance !== undefined &&
        amountBig > evmBalance,
      isDataPending: evmIsDataPending,
      isAmountLocked: evmActiveRequest !== null || evmAwaitingIndexer,
      lockedAmountRaw:
        evmDecimals !== undefined ? evmLockedAmountRaw : undefined,
      requestId: evmRequestId,
      requestIsConfirmed: evmRequestIsConfirmed,
      isPendingVerification: evmIsPendingVerification,
      isDepositCompleted: isDeposit && evmDepositIsCompleted,
      depositCompletedRequestId:
        isDeposit && evmDepositIsCompleted
          ? (evmDepositCompletedRequest?.request_id ?? undefined)
          : undefined,
      reset: () => {
        if (isDeposit) {
          evmRequestDeposit.reset();
          evmClaim.reset();
        } else {
          evmRequestWithdrawal.reset();
          evmClaimWithdrawal.reset();
        }
      },
      step1: {
        label: isDeposit
          ? "Allow Pipeline to use USDC"
          : "Allow Pipeline to use PLUSD",
        actionLabel: "Approve",
        state: evmStep1State,
        loading: isDeposit ? isDepositApprovePending : isWithdrawApprovePending,
        disabled: !canEvmApprove || wrongNetwork !== undefined,
        onAction: () => {
          const approve = isDeposit ? depositApprove : withdrawApprove;
          approve?.(amountBig);
        },
        errorMessage:
          evmStep1State === "error" ? evmStep1UserError?.message : undefined,
        errorDetails:
          evmStep1State === "error" ? evmStep1UserError?.details : undefined,
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
        disabled: !canEvmConfirm || wrongNetwork !== undefined,
        onAction: () => {
          if (isDeposit) evmRequestDeposit.write(amountBig);
          else evmRequestWithdrawal.write(amountBig);
        },
        hint:
          isWithdraw && evmStep2State === "idle"
            ? WITHDRAW_REQUEST_HINT
            : undefined,
        errorMessage:
          evmStep2State === "error" ? evmStep2UserError?.message : undefined,
        errorDetails:
          evmStep2State === "error" ? evmStep2UserError?.details : undefined,
      },
      step3: {
        label: isDeposit ? "Claim your PLUSD" : "Claim your USDC",
        actionLabel: "Claim",
        state: evmStep3State,
        loading: isDeposit ? evmClaim.isPending : evmClaimWithdrawal.isPending,
        disabled:
          !canEvmClaim || queueClaimBlocked || wrongNetwork !== undefined,
        hint: evmStep3State === "success" ? undefined : queueClaimHint,
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
        errorMessage:
          evmStep3State === "error" ? evmStep3UserError?.message : undefined,
        errorDetails:
          evmStep3State === "error" ? evmStep3UserError?.details : undefined,
      },
      withdrawQueue,
      step1Tx: {
        isPending: isDeposit
          ? isDepositApprovePending
          : isWithdrawApprovePending,
        isSuccess: isDeposit
          ? isDepositApproveSuccess
          : isWithdrawApproveSuccess,
        error: evmStep1Error,
        userError: evmStep1UserError,
      },
      step2Tx: {
        isPending: isDeposit
          ? evmRequestDeposit.isPending
          : evmRequestWithdrawal.isPending,
        isSuccess: isDeposit
          ? evmRequestDeposit.isSuccess
          : evmRequestWithdrawal.isSuccess,
        error: evmStep2Error,
        userError: evmStep2UserError,
      },
      step3Tx: {
        isPending: isDeposit
          ? evmClaim.isPending
          : evmClaimWithdrawal.isPending,
        isSuccess: isDeposit
          ? evmClaim.isSuccess
          : evmClaimWithdrawal.isSuccess,
        error: evmStep3Error,
        userError: evmStep3UserError,
      },
      isAnyTxInFlight: evmIsAnyTxInFlight,
      isInputFaded: evmIsInputFaded,
      networkFee: evmNetworkFee,
      refetchBalance: isDeposit
        ? refetchDepositBalance
        : refetchWithdrawBalance,
      onQuickAmount: onEvmDepositQuickAmount,
      trustlines: [],
      needsXlmFunding: false,
      wrongNetwork,
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
      ? (stellarUsdcBalanceRaw ?? 0n) >= (stellarMinDeposit as bigint)
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

  // Step 2 state (request).
  const stellarDepositStep2State: StepState =
    stellarDepositIsPendingClaim || stellarClaim.isSuccess
      ? "success"
      : stellarRequestDeposit.error && !stellarRequestDeposit.isPending
        ? "error"
        : "idle";
  const stellarWithdrawStep2State: StepState =
    stellarWithdrawIsPendingClaim || stellarClaimWithdrawal.isSuccess
      ? "success"
      : stellarRequestWithdrawal.error && !stellarRequestWithdrawal.isPending
        ? "error"
        : "idle";
  const stellarStep2State = isDeposit
    ? stellarDepositStep2State
    : stellarWithdrawStep2State;

  // Step 3 state (claim)
  const stellarStep3State: StepState = isDeposit
    ? stellarClaim.isSuccess
      ? "success"
      : stellarClaim.error && !stellarClaim.isPending
        ? "error"
        : "idle"
    : stellarClaimWithdrawal.isSuccess
      ? "success"
      : stellarClaimWithdrawal.error && !stellarClaimWithdrawal.isPending
        ? "error"
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

  // True when the PLUSD trustline exists but the issuer has not yet authorized it.
  // In this window Claim would fail with "balance is deauthorized" (contract error #11).
  const plusdTrustlineUnauthorized =
    isStellarConnected && !depositNeedsTrustline && !plusdSac.isAuthorized;

  const canStellarStep3Deposit =
    isStellarConnected &&
    stellarDepositRequestIdStr !== undefined &&
    stellarVoucher.status === "ready" &&
    !stellarClaim.isPending &&
    !stellarClaim.isSuccess &&
    !plusdTrustlineUnauthorized;
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

  // Mapped errors (#1034) — see the EVM path's equivalent consts above.
  // spec: docs/frontend/error-handling.md
  const stellarStep2Error = isDeposit
    ? stellarRequestDeposit.error
    : stellarRequestWithdrawal.error;
  const stellarStep2UserError = stellarStep2Error
    ? toUserError(stellarStep2Error)
    : undefined;
  const stellarStep3Error = isDeposit
    ? stellarClaim.error
    : stellarClaimWithdrawal.error;
  const stellarStep3UserError = stellarStep3Error
    ? toUserError(
        stellarStep3Error,
        isDeposit ? undefined : { context: "withdrawClaim" },
      )
    : undefined;

  const stellarInflight = isDeposit
    ? stellarDepositInflight
    : stellarWithdrawInflight;

  // Active request from the API (raw on-chain i128 at 7 decimals, same units as
  // the inflight amount). Preferred source for the locked amount so the input
  // keeps showing the deposited value once the request is confirmed/claimable
  // and the client-side inflight record has been cleared (mirrors EVM, #664-era
  // locked-amount behavior).
  const stellarActiveRequest = isDeposit
    ? stellarDepositActiveRequest
    : stellarWithdrawActiveRequest;

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

  const stellarMinChipLabel =
    stellarMinDeposit !== undefined
      ? `${formatUsdcCurrencyCompact(stellarMinDeposit, SAC_DECIMALS)} (Min)`
      : "Min";

  const stellarActiveBalance = isDeposit
    ? stellarUsdcBalanceRaw
    : stellarPlusdBalanceRaw;
  const stellarIsDataPending =
    (isDeposit ? usdcToken.isLoading : plusdSac.isLoading) ||
    xlm.isLoading ||
    requestsLoading ||
    (isStellarConnected && stellarActiveBalance === undefined);

  return {
    isConnected: isStellarConnected,
    connect: stellarConnect,
    address: stellarAddress,
    decimals: SAC_DECIMALS,
    formattedBalance: stellarFormattedBalance,
    balance: stellarBalance,
    plusdAuthorized:
      isStellarConnected && !plusdSac.isLoading
        ? plusdSac.isAuthorized
        : undefined,
    minDeposit: stellarMinDeposit,
    minChipLabel: stellarMinChipLabel,
    isReady: isStellarReady,
    hasBalance: stellarHasBalance,
    meetsMin: stellarMeetsMin,
    exceedsBalance:
      !stellarRequestIsConfirmed &&
      stellarBalance !== undefined &&
      amountBig > stellarBalance,
    isDataPending: stellarIsDataPending,
    isAmountLocked: stellarRequestIsConfirmed,
    lockedAmountRaw:
      stellarActiveRequest?.amount !== undefined
        ? BigInt(stellarActiveRequest.amount)
        : stellarInflight?.amount !== undefined
          ? BigInt(stellarInflight.amount)
          : undefined,
    requestId: stellarRequestId,
    requestIsConfirmed: stellarRequestIsConfirmed,
    isPendingVerification: stellarIsPendingVerification,
    isDepositCompleted: isDeposit && stellarDepositIsCompleted,
    depositCompletedRequestId:
      isDeposit && stellarDepositIsCompleted
        ? (stellarDepositCompletedRequest?.request_id ?? undefined)
        : undefined,
    reset: () => {
      if (isDeposit) {
        stellarRequestDeposit.reset();
        stellarClaim.reset();
      } else {
        stellarRequestWithdrawal.reset();
        stellarClaimWithdrawal.reset();
      }
    },
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
      hint:
        isWithdraw && stellarStep2State === "idle"
          ? WITHDRAW_REQUEST_HINT
          : undefined,
      errorMessage:
        stellarStep2State === "error"
          ? stellarStep2UserError?.message
          : undefined,
      errorDetails:
        stellarStep2State === "error"
          ? stellarStep2UserError?.details
          : undefined,
    },
    step3: {
      label: isDeposit
        ? plusdTrustlineUnauthorized
          ? "Claim your PLUSD — awaiting authorization"
          : "Claim your PLUSD"
        : "Claim your USDC",
      actionLabel: "Claim",
      state: stellarStep3State,
      loading: isDeposit
        ? stellarClaim.isPending
        : stellarClaimWithdrawal.isPending,
      disabled: !canStellarStep3 || queueClaimBlocked,
      hint: stellarStep3State === "success" ? undefined : queueClaimHint,
      onAction: () => {
        if (stellarRequestIdBigInt === undefined) return;
        const sig =
          stellarVoucher.status === "ready"
            ? (stellarVoucher as { signatureBytes?: Uint8Array }).signatureBytes
            : undefined;
        // `deadline` is required by the live on-chain `claim_request(request_id,
        // verifier_signature, deadline)` shape (see #800) — a voucher response
        // missing or malformed it must not be treated as claimable. Validate
        // it is a well-formed non-negative integer string before converting —
        // `BigInt("abc")` throws inside this uncaught handler, and
        // `BigInt("")` silently yields `0n`, defeating the "no bogus 0" intent.
        const deadlineRaw =
          stellarVoucher.status === "ready"
            ? stellarVoucher.data?.deadline
            : undefined;
        const deadline =
          deadlineRaw !== undefined && /^\d+$/.test(deadlineRaw)
            ? BigInt(deadlineRaw)
            : undefined;
        if (!sig || deadline === undefined) return;
        if (isDeposit) {
          stellarClaim.write(stellarRequestIdBigInt, sig, deadline);
        } else {
          stellarClaimWithdrawal.write(stellarRequestIdBigInt, sig, deadline);
        }
      },
      errorMessage:
        stellarStep3State === "error"
          ? stellarStep3UserError?.message
          : undefined,
      errorDetails:
        stellarStep3State === "error"
          ? stellarStep3UserError?.details
          : undefined,
    },
    withdrawQueue,
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
      error: stellarStep2Error,
      userError: stellarStep2UserError,
    },
    step3Tx: {
      isPending: isDeposit
        ? stellarClaim.isPending
        : stellarClaimWithdrawal.isPending,
      isSuccess: isDeposit
        ? stellarClaim.isSuccess
        : stellarClaimWithdrawal.isSuccess,
      error: stellarStep3Error,
      userError: stellarStep3UserError,
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
    needsXlmFunding: stellarNeedsXlmFunding,
    wrongNetwork: undefined,
  };
}
