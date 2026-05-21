import { useState, useCallback, useEffect, useRef } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Card, ConversionCard, DepositHeader, StepsCard } from "@pipeline/ui";
import {
  useWallet,
  useWithdrawalQueueAddresses,
  useRequestWithdrawal,
  useClaimWithdrawal,
  useToken,
} from "@/wallet";
import { useRequests, useWithdrawalVoucher } from "@/api";
import { ENV } from "@/lib/env";
import { parseUsdc, formatUsdc } from "@/lib/usdc";
import { useToast } from "@/lib/toast";

/**
 * Withdraw route — three-step conversion page.
 *
 * Drives three steps from on-chain reads and API polling:
 *
 * 1. **Allow Pipeline to use PLUSD** (Approve):
 *    Enabled when `needsApproval && canDeposit`. Done when allowance covers amount.
 *
 * 2. **Confirm PLUSD burn** (Confirm):
 *    Enabled when allowance is known to cover amountBig (hasSufficientAllowance)
 *    && canDeposit && !requestIsConfirmed.
 *    While status is `PendingVerification`, shows loading affordance (spinner,
 *    full opacity) — button stays non-clickable until verifier advances the
 *    request to `PendingClaim`. Done when status reaches `PendingClaim`.
 *
 * 3. **Claim your USDC** (Claim):
 *    Enabled when the request status is "PendingClaim" and a voucher signature
 *    is available from `GET /v1/withdrawals/{requestId}/voucher`.
 *    Done when `claim.isSuccess`.
 *
 * State machine (driven by `useRequests` polled every 60 s):
 *
 * - Pick the **latest active withdrawal request** (status = "PendingVerification"
 *   or "PendingClaim") from the response. If there is one, step 1 is
 *   automatically done and step 2 status depends on the request status.
 * - If no active request exists, fall back to the local `requestWithdrawal` state
 *   (mock path or real-path tx hash).
 *
 * State sources (all via `@/wallet` or `@/api` — no direct wagmi/viem imports):
 *   - `useWallet()` — isConnected
 *   - `useWithdrawalQueueAddresses()` — plusd (PLUSD token address)
 *   - `useToken({ token: plusd, spender: WITHDRAWAL_QUEUE_ADDRESS })` —
 *     PLUSD balance + decimals + formattedBalance + allowance + approve surface
 *   - `useRequestWithdrawal()` — write + pending/success/error state
 *   - `useClaimWithdrawal()` — write + pending/success/error state
 *   - `useRequests({ refetchInterval: 60_000 })` — polls for active requests
 *   - `useWithdrawalVoucher(requestId)` — fetches verifier signature when request
 *     status is "PendingClaim"
 *
 * **Amount input lock:** whenever `activeRequest` is non-null (status
 * `PendingVerification` or `PendingClaim`), the `isAmountLocked` flag is set.
 * While locked, the input value is synced from `activeRequest.amount` (via
 * `formatUsdc`, commas stripped) and both the `<input>` element and the four
 * quick-amount chips are disabled. The lock releases when the request resolves
 * (`Completed` / `VerificationFailed` / cleared from API); the input is NOT
 * auto-reset — the user can edit it for the next flow.
 *
 * Quick-amount chips are percentages of PLUSD balance (no Min chip — no minimum):
 *   - 25% → `balance * 25 / 100`
 *   - 50% → `balance / 2`
 *   - 75% → `balance * 75 / 100`
 *   - Max → `balance`
 *
 * Token discipline: no raw colors, fonts, sizes, or radii.
 * Everything goes through design tokens or component primitives from `@pipeline/ui`.
 *
 * Figma reference: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1498-100351&m=dev
 */

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

function Withdraw() {
  // ── Toast + navigation ────────────────────────────────────────────────
  const toast = useToast();
  const navigate = useNavigate();

  // ── State sources ─────────────────────────────────────────────────────
  const { isConnected } = useWallet();
  const {
    plusd,
    usdc: usdcFromQueue,
    isLoading: isQueueLoading,
  } = useWithdrawalQueueAddresses();

  // True when the wallet is connected, the hook has settled, and both token
  // addresses came back undefined — indicates a contract read failure.
  const isQueueUnreachable =
    isConnected &&
    !isQueueLoading &&
    plusd === undefined &&
    usdcFromQueue === undefined;

  // Fall back to zero-address when plusd is not yet loaded so the hook is
  // always called with a valid `0x${string}`.
  const plusdAddr = (plusd ?? ZERO_ADDRESS) as `0x${string}`;

  const {
    decimals,
    balance,
    formattedBalance,
    allowance,
    approve,
    isApprovePending,
    isApproveSuccess,
    refetchBalance,
  } = useToken({ token: plusdAddr, spender: ENV.WITHDRAWAL_QUEUE_ADDRESS });

  const requestWithdrawal = useRequestWithdrawal();
  const claim = useClaimWithdrawal();

  // Poll GET /v1/requests every 60 seconds to track the active withdrawal request.
  const { data: requestsData } = useRequests({ refetchInterval: 60_000 });

  // ── Local state ───────────────────────────────────────────────────────
  const [amountInput, setAmountInput] = useState("");

  // ── Derived state ─────────────────────────────────────────────────────
  const amountBig = parseUsdc(amountInput, decimals);

  // Both data sources must be non-undefined before we can decide on state.
  const isReady = decimals !== undefined && balance !== undefined;

  // canDeposit: true when amount is positive and does not exceed balance.
  // Note: no min-withdrawal gate — the contract has no minimum.
  const canDeposit =
    isReady && amountBig > 0n && amountBig <= (balance as bigint);

  const needsApproval =
    allowance !== undefined && amountBig > 0n && allowance < amountBig;

  // Positive "allowance is known and sufficient" gate. Distinct from
  // !needsApproval, which is true both when allowance covers the amount AND
  // when allowance is still undefined (loading). Step 2 / Confirm must only
  // unlock once we know the allowance covers amountBig.
  const hasSufficientAllowance =
    allowance !== undefined && amountBig > 0n && allowance >= amountBig;

  // ── Request state machine ─────────────────────────────────────────────
  // Pick the latest active withdrawal request from the polled list.
  // "Active" = status is "PendingVerification" (step 2 in-progress) or
  // "PendingClaim" (step 2 done, step 3 available).
  const activeRequest =
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

  // The request ID drives the voucher fetch.
  // Priority: API-polled request (real path) > local requestWithdrawal mock result.
  const requestId: string | undefined =
    activeRequest?.request_id ?? requestWithdrawal.data?.requestId;

  // The request is fully confirmed when it appears via API or when local
  // requestWithdrawal.isSuccess is true (mock path that also provides requestId).
  const requestIsConfirmed =
    activeRequest !== null ||
    (requestWithdrawal.isSuccess && requestId !== undefined);

  // Only fetch the voucher once the request is in "PendingClaim" status.
  const isPendingClaim = activeRequest?.status === "PendingClaim";
  // Step 2 is in progress (verifier working) while the API reports this status.
  const isPendingVerification = activeRequest?.status === "PendingVerification";
  const voucherRequestId = isPendingClaim ? requestId : undefined;

  // The amount input is locked to the active request's amount whenever
  // the API reports a PendingVerification or PendingClaim withdrawal. This
  // anchors the displayed value to what's already committed on-chain.
  // VerificationFailed and "no active request" leave the input editable.
  const isAmountLocked = activeRequest !== null;

  // Faded state: allowance is known-sufficient and step 2 ("Confirm") is the
  // live action, but no on-chain request has been submitted yet.
  // Using hasSufficientAllowance (not !needsApproval) avoids fading while
  // allowance is still loading (undefined).
  // Deliberately excludes isAmountLocked to avoid double-fading.
  const isInputFaded =
    isConnected && hasSufficientAllowance && !requestIsConfirmed;

  const voucher = useWithdrawalVoucher(voucherRequestId);

  // ── Step enable/disable gates ─────────────────────────────────────────
  const canApprove =
    isConnected &&
    canDeposit &&
    needsApproval &&
    !isApprovePending &&
    !requestIsConfirmed;

  const canConfirm =
    isConnected &&
    canDeposit &&
    hasSufficientAllowance &&
    !requestWithdrawal.isPending &&
    !requestIsConfirmed;

  const canClaim =
    isConnected &&
    requestId !== undefined &&
    voucher.status === "ready" &&
    !claim.isPending &&
    !claim.isSuccess;

  // ── Step state derivations ────────────────────────────────────────────
  // Step 1 is "success" once the allowance is known to cover the entered amount
  // (hasSufficientAllowance) OR once a request exists (approval already happened).
  // Using hasSufficientAllowance (not !needsApproval) avoids showing "Done"
  // while allowance is still loading (undefined).
  const step1State =
    (hasSufficientAllowance && isConnected) || requestIsConfirmed
      ? "success"
      : "idle";

  // Step 2 is "success" once the request is in PendingClaim status (verified).
  const step2State =
    isPendingClaim || claim.isSuccess ? "success" : ("idle" as const);

  // Step 3 is "success" once claim is done.
  const step3State = claim.isSuccess ? "success" : ("idle" as const);

  // ── Refetch balance after a successful claim ───────────────────────────
  useEffect(() => {
    if (claim.isSuccess) refetchBalance();
  }, [claim.isSuccess, refetchBalance]);

  // Keep the existing refetch on requestWithdrawal success.
  useEffect(() => {
    if (requestWithdrawal.isSuccess) refetchBalance();
  }, [requestWithdrawal.isSuccess, refetchBalance]);

  // ── Toast emission: Approve ────────────────────────────────────────────
  const prevIsApprovePending = useRef(false);
  const prevIsApproveSuccess = useRef(false);
  useEffect(() => {
    if (isApprovePending && !prevIsApprovePending.current) {
      toast.show({
        id: "withdraw-approve-tx",
        tone: "pending",
        title: "Approving PLUSD…",
      });
    }
    if (isApproveSuccess && !prevIsApproveSuccess.current) {
      toast.update("withdraw-approve-tx", {
        tone: "success",
        title: "Approval confirmed",
      });
    }
    prevIsApprovePending.current = isApprovePending;
    prevIsApproveSuccess.current = isApproveSuccess;
  }, [isApprovePending, isApproveSuccess, toast]);

  // ── Toast emission: RequestWithdrawal ─────────────────────────────────
  const prevWithdrawalIsPending = useRef(false);
  const prevWithdrawalIsSuccess = useRef(false);
  const prevWithdrawalError = useRef<Error | null>(null);
  useEffect(() => {
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
  ]);

  // ── Toast emission: Claim ──────────────────────────────────────────────
  const prevClaimIsPending = useRef(false);
  const prevClaimIsSuccess = useRef(false);
  const prevClaimError = useRef<Error | null>(null);
  useEffect(() => {
    if (claim.isPending && !prevClaimIsPending.current) {
      toast.show({
        id: "withdraw-claim-tx",
        tone: "pending",
        title: "Claiming…",
      });
    }
    if (claim.isSuccess && !prevClaimIsSuccess.current) {
      toast.update("withdraw-claim-tx", {
        tone: "success",
        title: "USDC claimed",
      });
    }
    if (claim.error && claim.error !== prevClaimError.current) {
      console.error("Withdrawal claim failed:", claim.error);
      toast.update("withdraw-claim-tx", {
        tone: "danger",
        title: "Claim failed",
      });
    }
    prevClaimIsPending.current = claim.isPending;
    prevClaimIsSuccess.current = claim.isSuccess;
    prevClaimError.current = claim.error;
  }, [claim.isPending, claim.isSuccess, claim.error, toast]);

  // When a withdrawal request becomes active (PendingVerification or PendingClaim),
  // copy its amount into the input so the displayed value matches what's already
  // committed on-chain. Do not auto-clear the input when the request resolves.
  //
  // Deps use activeRequest?.request_id and activeRequest?.amount (not the whole
  // object) to avoid re-firing on every 60 s poll when the request is unchanged.
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

  // ── Quick-amount handlers ─────────────────────────────────────────────
  // Chips are percentages of PLUSD balance: 25% / 50% / 75% / Max.
  // No Min chip — the contract has no minimum withdrawal.
  const onQuickAmount = useCallback(
    (idx: number) => {
      if (isAmountLocked) return;
      if (decimals === undefined || balance === undefined) return;
      let next: bigint;
      if (idx === 0) next = ((balance as bigint) * 25n) / 100n;
      else if (idx === 1) next = (balance as bigint) / 2n;
      else if (idx === 2) next = ((balance as bigint) * 75n) / 100n;
      else if (idx === 3) next = balance as bigint;
      else return;
      setAmountInput(formatUsdc(next, decimals).replace(/,/g, ""));
    },
    [balance, decimals, isAmountLocked],
  );

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[var(--color-pipeline-paper)] text-[color:var(--color-pipeline-ink)]">
      {/* Centred narrow column — mirrors Figma's centred single-column layout
          for the withdraw / conversion screen. py-12 gives breathing room under
          the TopBar; gap-6 (24px) matches the vertical spacing between sections. */}
      <main className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-12">
        {/* Section header: PLUSD coin icon + "1:1 Conversion" heading */}
        <DepositHeader title="1:1 Conversion" />

        {/* Conversion card: PLUSD input + USDC output + info rows (reversed vs deposit) */}
        <ConversionCard
          input={{
            token: "plusd",
            tokenLabel: "PLUSD",
            // formattedBalance from useToken is a plain decimal string like "1,000.00".
            // Fall back to "—" while loading.
            balanceLabel: formattedBalance
              ? formattedBalance.replace(/^\$/, "")
              : "—",
            placeholderValue: "0",
            // Controlled value state
            value: amountInput,
            onValueChange: setAmountInput,
            // Disable when the amount is locked to an active on-chain request.
            disabled: !isConnected || !isReady || isAmountLocked,
            // Fade the PLUSD value container once the allowance is approved and
            // step 2 is live. Purely visual — input remains editable.
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
          }}
          output={{
            token: "usdc",
            tokenLabel: "USDC",
            balanceLabel: "0.00",
            // 1:1 conversion rate — echo the input (empty → "0")
            value: amountInput || "0",
          }}
          exchangeRate="1 PLUSD = 1 USDC"
          // Network fee is not estimated in this issue — leave as dash rather
          // than rendering stale/fake placeholder copy.
          networkFee="—"
        />

        {/* Conditional: unreachable-contract banner OR three-step card */}
        {isQueueUnreachable ? (
          /* WithdrawalQueue not reachable — replaces StepsCard.
             Uses danger tokens to visually distinguish from the yellow
             low-balance banner on the deposit page.
             Shown only when connected and the contract read has settled
             with both addresses undefined. */
          <Card
            className="border-[color:var(--color-pipeline-danger)] bg-[var(--color-pipeline-danger)] text-[color:var(--color-pipeline-on-danger)]"
            data-testid="wq-unreachable-banner"
          >
            <p className="font-[family-name:var(--font-display)] text-[length:var(--text-pipeline-heading-s)]">
              WithdrawalQueue not reachable
            </p>
            <p className="mt-1 font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-caption)]">
              Check <code>VITE_WITHDRAWAL_QUEUE_ADDRESS</code> and RPC
              connectivity.
            </p>
          </Card>
        ) : (
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
                // loading covers three situations:
                // 1. wagmi write in-flight (this session)
                // 2. API reports PendingVerification (verifier still working,
                //    possibly from a prior session)
                // 3. Brief post-success window before API picks up the new request
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
        )}
      </main>
    </div>
  );
}

export const Route = createFileRoute("/withdraw")({
  component: Withdraw,
});
