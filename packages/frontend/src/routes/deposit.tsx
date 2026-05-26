import { useState, useCallback, useEffect, useRef } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Card,
  ConversionCard,
  DepositHeader,
  StepsCard,
  Button,
} from "@pipeline/ui";
import {
  useWallet,
  useDepositManagerAddresses,
  useDepositManagerMinDeposit,
  useRequestDeposit,
  useToken,
  useClaim,
  useRequestWithdrawal,
  useClaimWithdrawal,
  useNetworkFeeEstimate,
} from "@/wallet";
import { useRequests, useDepositVoucher, useWithdrawalVoucher } from "@/api";
import { ENV } from "@/lib/env";
import { parseUsdc, formatUsdc, formatUsdcCurrency } from "@/lib/usdc";
import { useToast } from "@/lib/toast";

/**
 * Deposit/Withdraw route — merged three-step conversion page.
 *
 * Direction is driven by the `?direction=deposit|withdraw` search param.
 * Unknown values fall back to `"deposit"`.
 *
 * URL contract:
 *   /deposit                       → direction = "deposit"
 *   /deposit?direction=deposit     → direction = "deposit"
 *   /deposit?direction=withdraw    → direction = "withdraw"
 *   /deposit?direction=<anything>  → falls back to "deposit"
 *   /withdraw                      → redirected here with direction=withdraw
 *
 * Drives three steps from on-chain reads and API polling:
 *
 * --- Deposit direction ---
 * 1. **Allow Pipeline to use USDC** (Approve):
 *    Enabled when `needsApproval && meetsMin`. Done when allowance covers amount.
 *    Figma: node 1498-99874
 *
 * 2. **Confirm USDC transfer** (Confirm):
 *    Enabled when `!needsApproval && meetsMin && requestId === undefined`.
 *    While status is `PendingVerification`, shows loading affordance.
 *    Figma: node 1497-95272
 *
 * 3. **Claim your PLUSD** (Claim):
 *    Enabled when the request status is "PendingClaim" and a voucher signature
 *    is available from `GET /v1/deposits/{requestId}/voucher`.
 *    Figma: node 1498-100812
 *
 * --- Withdraw direction ---
 * 1. **Allow Pipeline to use PLUSD** (Approve):
 *    Enabled when `needsApproval && canDeposit` (no min-withdrawal gate).
 *
 * 2. **Confirm PLUSD burn** (Confirm):
 *    Enabled when `hasSufficientAllowance && canDeposit && !requestIsConfirmed`.
 *
 * 3. **Claim your USDC** (Claim):
 *    Enabled when status is "PendingClaim" and voucher is ready.
 *
 * Tx/toast state on swap: direction swap does NOT reset wagmi write state or
 * toast trackers. Only the amount input is cleared. Swapping back to the prior
 * direction recovers the in-flight view. Toast ids are scoped per direction
 * (deposit: approve-tx / deposit-tx / claim-tx; withdraw: withdraw-approve-tx /
 * withdraw-tx / withdraw-claim-tx) so a stale toast from one direction does not
 * collide with a new one after swap.
 *
 * All hooks are called unconditionally per React's Rules of Hooks.
 * Behaviour branches on `direction`. Inactive-direction data is ignored.
 *
 * State sources (all via `@/wallet` or `@/api` — no direct wagmi/viem imports):
 *   Deposit:
 *     - `useDepositManagerAddresses()` — usdc/plusd addresses
 *     - `useDepositManagerMinDeposit()` — minimum deposit amount
 *     - `useToken({ token: usdc, spender: DEPOSIT_MANAGER_ADDRESS })`
 *     - `useRequestDeposit()` — write + state
 *     - `useClaim()` — write + state
 *   Withdraw:
 *     - `useDepositManagerAddresses()` — plusd/usdc addresses (reused; same source as deposit)
 *     - `useToken({ token: plusd, spender: WITHDRAWAL_QUEUE_ADDRESS })`
 *     - `useRequestWithdrawal()` — write + state
 *     - `useClaimWithdrawal()` — write + state
 *   Shared:
 *     - `useWallet()` — address, isConnected
 *     - `useRequests({ refetchInterval: 60_000 })` — polls active requests
 *     - `useDepositVoucher(requestId)` — deposit voucher
 *     - `useWithdrawalVoucher(requestId)` — withdrawal voucher
 *
 * Figma references:
 *   Deposit page: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1498-100812
 *   Withdraw page: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1498-100351
 *   Swap button: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1498-100157
 */

// ── Types ─────────────────────────────────────────────────────────────────────

type Direction = "deposit" | "withdraw";

// ── Route ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/deposit")({
  validateSearch: (raw): { direction: Direction } => ({
    direction: raw?.direction === "withdraw" ? "withdraw" : "deposit",
  }),
  component: Deposit,
});

// ── Constants ─────────────────────────────────────────────────────────────────

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

// ── Component ─────────────────────────────────────────────────────────────────

function Deposit() {
  // ── Direction ─────────────────────────────────────────────────────────
  const { direction } = Route.useSearch();

  // ── Toast + navigation ────────────────────────────────────────────────
  const toast = useToast();
  const navigate = useNavigate();

  // ── State sources ─────────────────────────────────────────────────────
  const { address, isConnected } = useWallet();

  // ── Deposit-direction hooks (called unconditionally) ──────────────────
  const {
    plusd: plusdFromManager,
    usdc,
    isLoading: isManagerLoading,
  } = useDepositManagerAddresses();
  const { minDeposit } = useDepositManagerMinDeposit();

  const usdcAddr = (usdc ?? ZERO_ADDRESS) as `0x${string}`;
  const {
    decimals: depositDecimals,
    balance: depositBalance,
    formattedBalance: depositFormattedBalance,
    allowance: depositAllowance,
    approve: depositApprove,
    isApprovePending: isDepositApprovePending,
    isApproveSuccess: isDepositApproveSuccess,
    refetchBalance: refetchDepositBalance,
  } = useToken({ token: usdcAddr, spender: ENV.DEPOSIT_MANAGER_ADDRESS });

  const requestDeposit = useRequestDeposit();
  const claim = useClaim();

  // ── Withdraw-direction hooks (called unconditionally) ─────────────────
  // plusd and usdc addresses are sourced from DepositManager (same as deposit
  // direction) — the deployed WithdrawalQueue does not expose token getters.
  const plusdAddr = (plusdFromManager ?? ZERO_ADDRESS) as `0x${string}`;
  const {
    decimals: withdrawDecimals,
    balance: withdrawBalance,
    formattedBalance: withdrawFormattedBalance,
    allowance: withdrawAllowance,
    approve: withdrawApprove,
    isApprovePending: isWithdrawApprovePending,
    isApproveSuccess: isWithdrawApproveSuccess,
    refetchBalance: refetchWithdrawBalance,
  } = useToken({ token: plusdAddr, spender: ENV.WITHDRAWAL_QUEUE_ADDRESS });

  const requestWithdrawal = useRequestWithdrawal();
  const claimWithdrawal = useClaimWithdrawal();

  // ── Network fee estimate (both directions, called unconditionally) ────────
  // Hook is called twice — once per direction — so both estimates are always
  // live regardless of which direction is active.  Rules of Hooks require
  // unconditional calls; direction is passed as a stable string literal.
  const { feeEth: depositFeeEth } = useNetworkFeeEstimate("deposit");
  const { feeEth: withdrawFeeEth } = useNetworkFeeEstimate("withdraw");

  // ── Shared: requests poll + vouchers (both called unconditionally) ────
  const { data: requestsData } = useRequests({ refetchInterval: 60_000 });

  // ── Local state ───────────────────────────────────────────────────────
  const [amountInput, setAmountInput] = useState("");
  const [copied, setCopied] = useState(false);

  // ── Active-direction derived state ────────────────────────────────────
  const isDeposit = direction === "deposit";

  // Active network fee — selects the already-live estimate for the current direction.
  const networkFee = isDeposit ? depositFeeEth : withdrawFeeEth;

  // Active token state (used in render and per-direction logic)
  const decimals = isDeposit ? depositDecimals : withdrawDecimals;
  const formattedBalance = isDeposit
    ? depositFormattedBalance
    : withdrawFormattedBalance;
  const approve = isDeposit ? depositApprove : withdrawApprove;
  const isApprovePending = isDeposit
    ? isDepositApprovePending
    : isWithdrawApprovePending;

  // ── Contract reachability ─────────────────────────────────────────────
  const isManagerUnreachable =
    isConnected &&
    !isManagerLoading &&
    plusdFromManager === undefined &&
    usdc === undefined;

  // ── Shared amount parsing ─────────────────────────────────────────────
  const amountBig = parseUsdc(amountInput, decimals);

  // ── Deposit-specific derived state ───────────────────────────────────
  const isDepositReady =
    depositDecimals !== undefined &&
    depositBalance !== undefined &&
    minDeposit !== undefined;

  const hasBalance = isDepositReady
    ? (depositBalance as bigint) >= (minDeposit as bigint)
    : undefined;

  const depositNeedsApproval =
    depositAllowance !== undefined &&
    amountBig > 0n &&
    depositAllowance < amountBig;

  const depositMeetsMin =
    minDeposit !== undefined && amountBig > 0n && amountBig >= minDeposit;

  // ── Withdraw-specific derived state ──────────────────────────────────
  const isWithdrawReady =
    withdrawDecimals !== undefined && withdrawBalance !== undefined;

  const canWithdraw =
    isWithdrawReady &&
    amountBig > 0n &&
    amountBig <= ((withdrawBalance as bigint) ?? 0n);

  const withdrawNeedsApproval =
    withdrawAllowance !== undefined &&
    amountBig > 0n &&
    withdrawAllowance < amountBig;

  const hasSufficientWithdrawAllowance =
    withdrawAllowance !== undefined &&
    amountBig > 0n &&
    withdrawAllowance >= amountBig;

  // ── Unified derived state (active direction) ──────────────────────────
  const isReady = isDeposit ? isDepositReady : isWithdrawReady;

  // ── Request state machines (both directions, called unconditionally) ──
  const depositActiveRequest =
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

  const withdrawActiveRequest =
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

  // Active-direction request state
  const activeRequest = isDeposit
    ? depositActiveRequest
    : withdrawActiveRequest;

  // Request IDs
  const depositRequestId: string | undefined =
    depositActiveRequest?.request_id ?? requestDeposit.data?.requestId;
  const withdrawRequestId: string | undefined =
    withdrawActiveRequest?.request_id ?? requestWithdrawal.data?.requestId;
  const requestId = isDeposit ? depositRequestId : withdrawRequestId;

  // Confirmed state
  const depositRequestIsConfirmed =
    depositActiveRequest !== null ||
    (requestDeposit.isSuccess && depositRequestId !== undefined);
  const withdrawRequestIsConfirmed =
    withdrawActiveRequest !== null ||
    (requestWithdrawal.isSuccess && withdrawRequestId !== undefined);
  const requestIsConfirmed = isDeposit
    ? depositRequestIsConfirmed
    : withdrawRequestIsConfirmed;

  // Pending states
  const depositIsPendingClaim = depositActiveRequest?.status === "PendingClaim";
  const depositIsPendingVerification =
    depositActiveRequest?.status === "PendingVerification";
  const withdrawIsPendingClaim =
    withdrawActiveRequest?.status === "PendingClaim";
  const withdrawIsPendingVerification =
    withdrawActiveRequest?.status === "PendingVerification";

  const isPendingVerification = isDeposit
    ? depositIsPendingVerification
    : withdrawIsPendingVerification;

  // Voucher request IDs: only pass to active-direction voucher; pass undefined
  // to inactive voucher hook to disable it.
  const depositVoucherRequestId = depositIsPendingClaim
    ? depositRequestId
    : undefined;
  const withdrawVoucherRequestId = withdrawIsPendingClaim
    ? withdrawRequestId
    : undefined;

  // Both voucher hooks called unconditionally; inactive one gets undefined.
  const depositVoucher = useDepositVoucher(depositVoucherRequestId);
  const withdrawVoucher = useWithdrawalVoucher(withdrawVoucherRequestId);
  const voucher = isDeposit ? depositVoucher : withdrawVoucher;

  // Amount lock
  const isAmountLocked = activeRequest !== null;

  // ── Step gate derivations ─────────────────────────────────────────────
  // Deposit step gates
  const canDepositApprove =
    isConnected &&
    hasBalance === true &&
    depositMeetsMin &&
    depositNeedsApproval &&
    !isDepositApprovePending &&
    !depositRequestIsConfirmed;

  const canDepositConfirm =
    isConnected &&
    hasBalance === true &&
    depositMeetsMin &&
    !depositNeedsApproval &&
    !requestDeposit.isPending &&
    !depositRequestIsConfirmed;

  const canDepositClaim =
    isConnected &&
    depositRequestId !== undefined &&
    depositVoucher.status === "ready" &&
    !claim.isPending &&
    !claim.isSuccess;

  // Withdraw step gates
  const canWithdrawApprove =
    isConnected &&
    canWithdraw &&
    withdrawNeedsApproval &&
    !isWithdrawApprovePending &&
    !withdrawRequestIsConfirmed;

  const canWithdrawConfirm =
    isConnected &&
    canWithdraw &&
    hasSufficientWithdrawAllowance &&
    !requestWithdrawal.isPending &&
    !withdrawRequestIsConfirmed;

  const canWithdrawClaim =
    isConnected &&
    withdrawRequestId !== undefined &&
    withdrawVoucher.status === "ready" &&
    !claimWithdrawal.isPending &&
    !claimWithdrawal.isSuccess;

  // Active-direction gate
  const canApprove = isDeposit ? canDepositApprove : canWithdrawApprove;
  const canConfirm = isDeposit ? canDepositConfirm : canWithdrawConfirm;
  const canClaim = isDeposit ? canDepositClaim : canWithdrawClaim;

  // ── Swap button disabled: any in-flight wallet action ─────────────────
  const isAnyTxInFlight =
    isDepositApprovePending ||
    requestDeposit.isPending ||
    claim.isPending ||
    isWithdrawApprovePending ||
    requestWithdrawal.isPending ||
    claimWithdrawal.isPending;

  // ── Step state derivations ────────────────────────────────────────────
  // Deposit
  const depositStep1State =
    (!depositNeedsApproval && amountBig > 0n && isConnected) ||
    depositRequestIsConfirmed
      ? "success"
      : "idle";
  const depositStep2State =
    depositIsPendingClaim || claim.isSuccess ? "success" : ("idle" as const);
  const depositStep3State = claim.isSuccess ? "success" : ("idle" as const);

  // Withdraw
  const withdrawStep1State =
    (hasSufficientWithdrawAllowance && isConnected) ||
    withdrawRequestIsConfirmed
      ? "success"
      : "idle";
  const withdrawStep2State =
    withdrawIsPendingClaim || claimWithdrawal.isSuccess
      ? "success"
      : ("idle" as const);
  const withdrawStep3State = claimWithdrawal.isSuccess
    ? "success"
    : ("idle" as const);

  // Active-direction step states
  const step1State = isDeposit ? depositStep1State : withdrawStep1State;
  const step2State = isDeposit ? depositStep2State : withdrawStep2State;
  const step3State = isDeposit ? depositStep3State : withdrawStep3State;

  // Faded state (deposit-only: approved step 2 live)
  const isDepositInputFaded =
    hasBalance === false ||
    (isConnected &&
      !depositNeedsApproval &&
      amountBig > 0n &&
      !depositRequestIsConfirmed);

  // Withdraw fade: allowance is known-sufficient and step 2 is live
  const isWithdrawInputFaded =
    isConnected &&
    hasSufficientWithdrawAllowance &&
    !withdrawRequestIsConfirmed;

  const isInputFaded = isDeposit ? isDepositInputFaded : isWithdrawInputFaded;

  // ── Effects: refetch balance after success ────────────────────────────
  useEffect(() => {
    if (direction !== "deposit") return;
    if (claim.isSuccess) refetchDepositBalance();
  }, [claim.isSuccess, refetchDepositBalance, direction]);

  useEffect(() => {
    if (direction !== "deposit") return;
    if (requestDeposit.isSuccess) refetchDepositBalance();
  }, [requestDeposit.isSuccess, refetchDepositBalance, direction]);

  useEffect(() => {
    if (direction !== "withdraw") return;
    if (claimWithdrawal.isSuccess) refetchWithdrawBalance();
  }, [claimWithdrawal.isSuccess, refetchWithdrawBalance, direction]);

  useEffect(() => {
    if (direction !== "withdraw") return;
    if (requestWithdrawal.isSuccess) refetchWithdrawBalance();
  }, [requestWithdrawal.isSuccess, refetchWithdrawBalance, direction]);

  // ── Toast emission: Deposit Approve ──────────────────────────────────
  const prevIsDepositApprovePending = useRef(false);
  const prevIsDepositApproveSuccess = useRef(false);
  useEffect(() => {
    if (direction !== "deposit") return;
    if (isDepositApprovePending && !prevIsDepositApprovePending.current) {
      toast.show({
        id: "approve-tx",
        tone: "pending",
        title: "Approving USDC…",
      });
    }
    if (isDepositApproveSuccess && !prevIsDepositApproveSuccess.current) {
      toast.update("approve-tx", {
        tone: "success",
        title: "Approval confirmed",
      });
    }
    prevIsDepositApprovePending.current = isDepositApprovePending;
    prevIsDepositApproveSuccess.current = isDepositApproveSuccess;
  }, [isDepositApprovePending, isDepositApproveSuccess, toast, direction]);

  // ── Toast emission: Deposit ───────────────────────────────────────────
  const prevDepositIsPending = useRef(false);
  const prevDepositIsSuccess = useRef(false);
  const prevDepositError = useRef<Error | null>(null);
  useEffect(() => {
    if (direction !== "deposit") return;
    if (requestDeposit.isPending && !prevDepositIsPending.current) {
      toast.show({ id: "deposit-tx", tone: "pending", title: "Sending…" });
    }
    if (requestDeposit.isSuccess && !prevDepositIsSuccess.current) {
      toast.update("deposit-tx", {
        tone: "success",
        title: "Deposit submitted",
        action: {
          label: "View",
          onClick: () => void navigate({ to: "/transactions" }),
        },
      });
    }
    if (
      requestDeposit.error &&
      requestDeposit.error !== prevDepositError.current
    ) {
      console.error("Deposit failed:", requestDeposit.error);
      toast.update("deposit-tx", {
        tone: "danger",
        title: "Deposit failed",
        action: undefined,
      });
    }
    prevDepositIsPending.current = requestDeposit.isPending;
    prevDepositIsSuccess.current = requestDeposit.isSuccess;
    prevDepositError.current = requestDeposit.error;
  }, [
    requestDeposit.isPending,
    requestDeposit.isSuccess,
    requestDeposit.error,
    toast,
    navigate,
    direction,
  ]);

  // ── Toast emission: Deposit Claim ─────────────────────────────────────
  const prevClaimIsPending = useRef(false);
  const prevClaimIsSuccess = useRef(false);
  const prevClaimError = useRef<Error | null>(null);
  useEffect(() => {
    if (direction !== "deposit") return;
    if (claim.isPending && !prevClaimIsPending.current) {
      toast.show({ id: "claim-tx", tone: "pending", title: "Claiming…" });
    }
    if (claim.isSuccess && !prevClaimIsSuccess.current) {
      toast.update("claim-tx", { tone: "success", title: "PLUSD claimed" });
    }
    if (claim.error && claim.error !== prevClaimError.current) {
      console.error("Claim failed:", claim.error);
      toast.update("claim-tx", { tone: "danger", title: "Claim failed" });
    }
    prevClaimIsPending.current = claim.isPending;
    prevClaimIsSuccess.current = claim.isSuccess;
    prevClaimError.current = claim.error;
  }, [claim.isPending, claim.isSuccess, claim.error, toast, direction]);

  // ── Toast emission: Withdraw Approve ─────────────────────────────────
  const prevIsWithdrawApprovePending = useRef(false);
  const prevIsWithdrawApproveSuccess = useRef(false);
  useEffect(() => {
    if (direction !== "withdraw") return;
    if (isWithdrawApprovePending && !prevIsWithdrawApprovePending.current) {
      toast.show({
        id: "withdraw-approve-tx",
        tone: "pending",
        title: "Approving PLUSD…",
      });
    }
    if (isWithdrawApproveSuccess && !prevIsWithdrawApproveSuccess.current) {
      toast.update("withdraw-approve-tx", {
        tone: "success",
        title: "Approval confirmed",
      });
    }
    prevIsWithdrawApprovePending.current = isWithdrawApprovePending;
    prevIsWithdrawApproveSuccess.current = isWithdrawApproveSuccess;
  }, [isWithdrawApprovePending, isWithdrawApproveSuccess, toast, direction]);

  // ── Toast emission: RequestWithdrawal ────────────────────────────────
  const prevWithdrawalIsPending = useRef(false);
  const prevWithdrawalIsSuccess = useRef(false);
  const prevWithdrawalError = useRef<Error | null>(null);
  useEffect(() => {
    if (direction !== "withdraw") return;
    if (requestWithdrawal.isPending && !prevWithdrawalIsPending.current) {
      toast.show({ id: "withdraw-tx", tone: "pending", title: "Sending…" });
    }
    if (requestWithdrawal.isSuccess && !prevWithdrawalIsSuccess.current) {
      toast.update("withdraw-tx", {
        tone: "success",
        title: "Withdrawal submitted",
        action: {
          label: "View",
          onClick: () => void navigate({ to: "/transactions" }),
        },
      });
    }
    if (
      requestWithdrawal.error &&
      requestWithdrawal.error !== prevWithdrawalError.current
    ) {
      console.error("Withdrawal failed:", requestWithdrawal.error);
      toast.update("withdraw-tx", {
        tone: "danger",
        title: "Withdrawal failed",
        action: undefined,
      });
    }
    prevWithdrawalIsPending.current = requestWithdrawal.isPending;
    prevWithdrawalIsSuccess.current = requestWithdrawal.isSuccess;
    prevWithdrawalError.current = requestWithdrawal.error;
  }, [
    requestWithdrawal.isPending,
    requestWithdrawal.isSuccess,
    requestWithdrawal.error,
    toast,
    navigate,
    direction,
  ]);

  // ── Toast emission: Withdraw Claim ────────────────────────────────────
  const prevWithdrawClaimIsPending = useRef(false);
  const prevWithdrawClaimIsSuccess = useRef(false);
  const prevWithdrawClaimError = useRef<Error | null>(null);
  useEffect(() => {
    if (direction !== "withdraw") return;
    if (claimWithdrawal.isPending && !prevWithdrawClaimIsPending.current) {
      toast.show({
        id: "withdraw-claim-tx",
        tone: "pending",
        title: "Claiming…",
      });
    }
    if (claimWithdrawal.isSuccess && !prevWithdrawClaimIsSuccess.current) {
      toast.update("withdraw-claim-tx", {
        tone: "success",
        title: "USDC claimed",
      });
    }
    if (
      claimWithdrawal.error &&
      claimWithdrawal.error !== prevWithdrawClaimError.current
    ) {
      console.error("Withdrawal claim failed:", claimWithdrawal.error);
      toast.update("withdraw-claim-tx", {
        tone: "danger",
        title: "Claim failed",
      });
    }
    prevWithdrawClaimIsPending.current = claimWithdrawal.isPending;
    prevWithdrawClaimIsSuccess.current = claimWithdrawal.isSuccess;
    prevWithdrawClaimError.current = claimWithdrawal.error;
  }, [
    claimWithdrawal.isPending,
    claimWithdrawal.isSuccess,
    claimWithdrawal.error,
    toast,
    direction,
  ]);

  // ── Amount sync: lock input to active request amount ─────────────────
  useEffect(() => {
    if (!isAmountLocked) return;
    if (decimals === undefined) return;
    if (!activeRequest) return;
    const formatted = formatUsdc(
      BigInt(activeRequest.amount),
      decimals,
    ).replace(/,/g, "");
    setAmountInput(formatted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isAmountLocked,
    activeRequest?.request_id,
    activeRequest?.amount,
    decimals,
  ]);

  // ── Copy address handler (1.5s "Copied" affordance) ───────────────────
  const copyAddress = useCallback(() => {
    if (!address || typeof navigator === "undefined" || !navigator.clipboard)
      return;
    navigator.clipboard.writeText(address).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {
        /* Silently no-op when clipboard write fails (e.g. non-secure context). */
      },
    );
  }, [address]);

  // ── Quick-amount handlers ─────────────────────────────────────────────
  const onDepositQuickAmount = useCallback(
    (idx: number) => {
      if (isAmountLocked) return;
      if (depositDecimals === undefined) return;
      if (idx === 0 && minDeposit !== undefined) {
        setAmountInput(
          formatUsdc(minDeposit, depositDecimals).replace(/,/g, ""),
        );
        return;
      }
      if (idx === 1) setAmountInput("5000");
      else if (idx === 2) setAmountInput("10000");
      else if (idx === 3 && depositBalance !== undefined) {
        setAmountInput(
          formatUsdc(depositBalance as bigint, depositDecimals).replace(
            /,/g,
            "",
          ),
        );
      }
    },
    [depositDecimals, minDeposit, depositBalance, isAmountLocked],
  );

  const onWithdrawQuickAmount = useCallback(
    (idx: number) => {
      if (isAmountLocked) return;
      if (withdrawDecimals === undefined || withdrawBalance === undefined)
        return;
      let next: bigint;
      if (idx === 0) next = ((withdrawBalance as bigint) * 25n) / 100n;
      else if (idx === 1) next = (withdrawBalance as bigint) / 2n;
      else if (idx === 2) next = ((withdrawBalance as bigint) * 75n) / 100n;
      else if (idx === 3) next = withdrawBalance as bigint;
      else return;
      setAmountInput(formatUsdc(next, withdrawDecimals).replace(/,/g, ""));
    },
    [withdrawDecimals, withdrawBalance, isAmountLocked],
  );

  const onQuickAmount = isDeposit
    ? onDepositQuickAmount
    : onWithdrawQuickAmount;

  // ── Swap handler ──────────────────────────────────────────────────────
  const onSwap = useCallback(() => {
    const next: Direction = direction === "deposit" ? "withdraw" : "deposit";
    setAmountInput("");
    void navigate({
      to: "/deposit",
      search: { direction: next },
      replace: true,
    });
  }, [direction, navigate]);

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[var(--color-pipeline-paper)] text-[color:var(--color-pipeline-ink)]">
      <main className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-12">
        {/* Section header */}
        <DepositHeader title="1:1 Conversion" />

        {/* Conversion card */}
        <ConversionCard
          input={
            isDeposit
              ? {
                  token: "usdc",
                  tokenLabel: "USDC",
                  balanceLabel: formattedBalance
                    ? formattedBalance.replace(/^\$/, "")
                    : "—",
                  placeholderValue: "0",
                  value: amountInput,
                  onValueChange: setAmountInput,
                  disabled: !isConnected || !isReady || isAmountLocked,
                  className: isInputFaded
                    ? "opacity-30 transition-opacity"
                    : "transition-opacity",
                  quickAmounts: [
                    {
                      label:
                        minDeposit !== undefined && decimals !== undefined
                          ? `${formatUsdcCurrency(minDeposit, decimals)} (Min)`
                          : "Min",
                      disabled: isAmountLocked,
                    },
                    { label: "$5,000", disabled: isAmountLocked },
                    { label: "$10,000", disabled: isAmountLocked },
                    { label: "Max", disabled: isAmountLocked },
                  ],
                  onQuickAmountClick: onQuickAmount,
                }
              : {
                  token: "plusd",
                  tokenLabel: "PLUSD",
                  balanceLabel: formattedBalance
                    ? formattedBalance.replace(/^\$/, "")
                    : "—",
                  placeholderValue: "0",
                  value: amountInput,
                  onValueChange: setAmountInput,
                  disabled: !isConnected || !isReady || isAmountLocked,
                  className: isInputFaded
                    ? "opacity-30 transition-opacity"
                    : "transition-opacity",
                  quickAmounts: [
                    { label: "25%", disabled: isAmountLocked },
                    { label: "50%", disabled: isAmountLocked },
                    { label: "75%", disabled: isAmountLocked },
                    { label: "Max", disabled: isAmountLocked },
                  ],
                  onQuickAmountClick: onQuickAmount,
                }
          }
          output={
            isDeposit
              ? {
                  token: "plusd",
                  tokenLabel: "PLUSD",
                  balanceLabel: "0.00",
                  value: amountInput || "0",
                }
              : {
                  token: "usdc",
                  tokenLabel: "USDC",
                  balanceLabel: "0.00",
                  value: amountInput || "0",
                }
          }
          exchangeRate={isDeposit ? "1 USDC = 1 PLUSD" : "1 PLUSD = 1 USDC"}
          networkFee={networkFee ?? "—"}
          onSwap={isAnyTxInFlight ? undefined : onSwap}
        />

        {/* Conditional: unreachable-contract banner, low-balance banner, OR three-step card */}
        {isManagerUnreachable ? (
          <Card variant="danger" data-testid="dm-unreachable-banner">
            <p className="font-[family-name:var(--font-display)] text-[length:var(--text-pipeline-heading-s)]">
              DepositManager not reachable
            </p>
            <p className="mt-1 font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-caption)]">
              Check <code>VITE_DEPOSIT_MANAGER_ADDRESS</code> and RPC
              connectivity.
            </p>
          </Card>
        ) : isDeposit && hasBalance === false ? (
          /* Insufficient-balance banner — deposit only. Figma: node 1825-10214. */
          <Card
            variant="yellow"
            className="flex flex-row items-center justify-between gap-4"
          >
            <div className="flex flex-col items-start gap-1">
              <p className="font-[family-name:var(--font-display)] text-[length:var(--text-pipeline-heading-s)]">
                Add funds to your USDC balance
              </p>
              <p className="font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-caption)] text-[color:var(--color-pipeline-ink-muted)]">
                Minimum amount —{" "}
                {minDeposit !== undefined && decimals !== undefined
                  ? `${formatUsdcCurrency(minDeposit, decimals)} USDC`
                  : "—"}
              </p>
            </div>
            <Button
              variant="primary-dark"
              onClick={copyAddress}
              disabled={!address}
            >
              {copied ? "Copied" : "Copy Address"}
            </Button>
          </Card>
        ) : isDeposit ? (
          /* Deposit three-step card */
          <StepsCard
            steps={[
              {
                label: "Allow Pipeline to use USDC",
                actionLabel: "Approve",
                disabled: !canApprove,
                loading: isApprovePending,
                state: step1State,
                onAction: () => approve?.(amountBig),
              },
              {
                label: "Confirm USDC transfer",
                actionLabel: "Confirm",
                disabled: !canConfirm,
                loading:
                  requestDeposit.isPending ||
                  isPendingVerification ||
                  (requestDeposit.isSuccess &&
                    !requestIsConfirmed &&
                    activeRequest === null),
                state: step2State,
                onAction: () => requestDeposit.write(amountBig),
              },
              {
                label: "Claim your PLUSD",
                actionLabel: "Claim",
                disabled: !canClaim,
                loading: voucher.status === "pending" || claim.isPending,
                state: step3State,
                onAction: () => {
                  if (requestId === undefined || !voucher.data?.signature)
                    return;
                  claim.write(
                    BigInt(requestId),
                    voucher.data.signature as `0x${string}`,
                  );
                },
              },
            ]}
          />
        ) : (
          /* Withdraw three-step card */
          <StepsCard
            steps={[
              {
                label: "Allow Pipeline to use PLUSD",
                actionLabel: "Approve",
                disabled: !canApprove,
                loading: isApprovePending,
                state: step1State,
                onAction: () => approve?.(amountBig),
              },
              {
                label: "Confirm PLUSD burn",
                actionLabel: "Confirm",
                disabled: !canConfirm,
                loading:
                  requestWithdrawal.isPending ||
                  isPendingVerification ||
                  (requestWithdrawal.isSuccess &&
                    !requestIsConfirmed &&
                    activeRequest === null),
                state: step2State,
                onAction: () => requestWithdrawal.write(amountBig),
              },
              {
                label: "Claim your USDC",
                actionLabel: "Claim",
                disabled: !canClaim,
                loading:
                  voucher.status === "pending" || claimWithdrawal.isPending,
                state: step3State,
                onAction: () => {
                  if (requestId === undefined || !voucher.data?.signature)
                    return;
                  claimWithdrawal.write(
                    BigInt(requestId),
                    voucher.data.signature as `0x${string}`,
                  );
                },
              },
            ]}
          />
        )}
      </main>
    </div>
  );
}
