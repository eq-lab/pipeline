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
} from "@/wallet";
import { useRequests, useDepositVoucher } from "@/api";
import { ENV } from "@/lib/env";
import { parseUsdc, formatUsdc, formatUsdcCurrency } from "@/lib/usdc";
import { useToast } from "@/lib/toast";

/**
 * Deposit route — three-step conversion page.
 *
 * Drives three steps from on-chain reads and API polling:
 *
 * 1. **Allow Pipeline to use USDC** (Approve):
 *    Enabled when `needsApproval && meetsMin`. Done when allowance covers amount.
 *    Figma: node 1498-99874
 *
 * 2. **Confirm USDC transfer** (Confirm):
 *    Enabled when `!needsApproval && meetsMin && requestId === undefined`.
 *    While status is `PendingVerification`, shows loading affordance (spinner,
 *    full opacity) — button stays non-clickable until verifier advances the
 *    request to `PendingClaim`. Done when status reaches `PendingClaim`.
 *    Figma: node 1497-95272
 *
 * 3. **Claim your PLUSD** (Claim):
 *    Enabled when the request status is "PendingClaim" and a voucher signature
 *    is available from `GET /v1/deposits/{requestId}/voucher`.
 *    Done when `claim.isSuccess`. Figma: node 1498-100812
 *
 * 4. **Insufficient balance**: StepsCard replaced by a low-balance banner.
 *    Figma: node 1825-10214
 *
 * State machine (driven by `useRequests` polled every 60 s):
 *
 * - Pick the **latest active deposit request** (status = "PendingVerification"
 *   or "PendingClaim") from the response. If there is one, step 1 is
 *   automatically done and step 2 status depends on the request status.
 * - If no active request exists, fall back to the local `requestDeposit` state
 *   (mock path or real-path tx hash).
 *
 * State sources (all via `@/wallet` or `@/api` — no direct wagmi/viem imports):
 *   - `useWallet()` — address, isConnected
 *   - `useDepositManagerAddresses()` — usdc token address
 *   - `useDepositManagerMinDeposit()` — minimum deposit amount
 *   - `useToken({ token: usdc, spender: DEPOSIT_MANAGER_ADDRESS })` —
 *     balance + decimals + formattedBalance + allowance + approve surface
 *   - `useRequestDeposit()` — write + pending/success/error state
 *   - `useClaim()` — write + pending/success/error state
 *   - `useRequests({ refetchInterval: 60_000 })` — polls for active requests
 *   - `useDepositVoucher(requestId)` — fetches verifier signature when request
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
 * Token discipline: no raw colors, fonts, sizes, or radii.
 * Everything goes through design tokens or component primitives from `@pipeline/ui`.
 *
 * Figma reference: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1498-100812&m=dev
 */

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

function Deposit() {
  // ── Toast + navigation ────────────────────────────────────────────────
  const toast = useToast();
  const navigate = useNavigate();

  // ── State sources ─────────────────────────────────────────────────────
  const { address, isConnected } = useWallet();
  const {
    plusd: plusdFromManager,
    usdc,
    isLoading: isManagerLoading,
  } = useDepositManagerAddresses();
  const { minDeposit } = useDepositManagerMinDeposit();

  // True when the wallet is connected, the hook has settled, and both token
  // addresses came back undefined — indicates a contract read failure.
  const isManagerUnreachable =
    isConnected &&
    !isManagerLoading &&
    plusdFromManager === undefined &&
    usdc === undefined;

  // Fall back to zero-address when usdc is not yet loaded so the hook is
  // always called with a valid `0x${string}`.
  const usdcAddr = (usdc ?? ZERO_ADDRESS) as `0x${string}`;

  const {
    decimals,
    balance,
    formattedBalance,
    allowance,
    approve,
    isApprovePending,
    isApproveSuccess,
    refetchBalance,
  } = useToken({ token: usdcAddr, spender: ENV.DEPOSIT_MANAGER_ADDRESS });

  const requestDeposit = useRequestDeposit();
  const claim = useClaim();

  // Poll GET /v1/requests every 60 seconds to track the active deposit request.
  const { data: requestsData } = useRequests({ refetchInterval: 60_000 });

  // ── Local state ───────────────────────────────────────────────────────
  const [amountInput, setAmountInput] = useState("");
  const [copied, setCopied] = useState(false);

  // ── Derived state ─────────────────────────────────────────────────────
  const amountBig = parseUsdc(amountInput, decimals);

  // All three data sources must be non-undefined before we can decide on state.
  const isReady =
    decimals !== undefined && balance !== undefined && minDeposit !== undefined;

  // hasBalance: undefined = loading; true = sufficient; false = insufficient
  const hasBalance = isReady ? balance >= minDeposit : undefined;

  const needsApproval =
    allowance !== undefined && amountBig > 0n && allowance < amountBig;

  // Amount must be a positive value AND at least the on-chain minDeposit.
  const meetsMin =
    minDeposit !== undefined && amountBig > 0n && amountBig >= minDeposit;

  // ── Request state machine ─────────────────────────────────────────────
  // Pick the latest active deposit request from the polled list.
  // "Active" = status is "PendingVerification" (step 2 in-progress) or
  // "PendingClaim" (step 2 done, step 3 available).
  const activeRequest =
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

  // The request ID drives the voucher fetch.
  // Priority: API-polled request (real path) > local requestDeposit mock result.
  const requestId: string | undefined =
    activeRequest?.request_id ?? requestDeposit.data?.requestId;

  // The request is fully confirmed when it appears via API or when local
  // requestDeposit.isSuccess is true (mock path that also provides requestId).
  const requestIsConfirmed =
    activeRequest !== null ||
    (requestDeposit.isSuccess && requestId !== undefined);

  // Only fetch the voucher once the request is in "PendingClaim" status.
  const isPendingClaim = activeRequest?.status === "PendingClaim";
  // Step 2 is in progress (verifier working) while the API reports this status.
  const isPendingVerification = activeRequest?.status === "PendingVerification";
  const voucherRequestId = isPendingClaim ? requestId : undefined;

  // The amount input is locked to the active request's amount whenever
  // the API reports a PendingVerification or PendingClaim deposit. This
  // anchors the displayed value to what's already committed on-chain.
  // VerificationFailed and "no active request" leave the input editable.
  // Note: activeRequest is non-null only when status is PendingVerification
  // or PendingClaim (see selector above), so this single check is sufficient.
  const isAmountLocked = activeRequest !== null;

  // Faded state: USDC value container is visually deemphasised in two cases:
  //   1. Low-balance state (#306): balance < minDeposit — deposit is impossible
  //      until the user funds their wallet. Entire input area fades to opacity-30.
  //   2. Post-approve state (#268): allowance approved and step 2 ("Confirm") is
  //      the live action, but no on-chain request has been submitted yet. Signals
  //      "the amount you entered is locked in" without disabling the input.
  // Deliberately excludes isAmountLocked (PendingVerification / PendingClaim)
  // to avoid double-fading with the disabled state in #243.
  // Figma: opacity-30 on the USDC value container node 1497:95279.
  const isInputFaded =
    hasBalance === false ||
    (isConnected && !needsApproval && amountBig > 0n && !requestIsConfirmed);

  const voucher = useDepositVoucher(voucherRequestId);

  // ── Step enable/disable gates ─────────────────────────────────────────
  const canApprove =
    isConnected &&
    hasBalance === true &&
    meetsMin &&
    needsApproval &&
    !isApprovePending &&
    !requestIsConfirmed;

  const canConfirm =
    isConnected &&
    hasBalance === true &&
    meetsMin &&
    !needsApproval &&
    !requestDeposit.isPending &&
    !requestIsConfirmed;

  const canClaim =
    isConnected &&
    requestId !== undefined &&
    voucher.status === "ready" &&
    !claim.isPending &&
    !claim.isSuccess;

  // ── Step state derivations ────────────────────────────────────────────
  // Step 1 is "success" once the allowance covers the entered amount
  // OR once a request exists (because at that point approval already happened).
  const step1State =
    (!needsApproval && amountBig > 0n && isConnected) || requestIsConfirmed
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

  // Keep the existing refetch on requestDeposit success.
  useEffect(() => {
    if (requestDeposit.isSuccess) refetchBalance();
  }, [requestDeposit.isSuccess, refetchBalance]);

  // ── Toast emission: Approve ────────────────────────────────────────────
  // Track previous state to detect edge transitions.
  const prevIsApprovePending = useRef(false);
  const prevIsApproveSuccess = useRef(false);
  useEffect(() => {
    if (isApprovePending && !prevIsApprovePending.current) {
      toast.show({
        id: "approve-tx",
        tone: "pending",
        title: "Approving USDC…",
      });
    }
    if (isApproveSuccess && !prevIsApproveSuccess.current) {
      toast.update("approve-tx", {
        tone: "success",
        title: "Approval confirmed",
      });
    }
    prevIsApprovePending.current = isApprovePending;
    prevIsApproveSuccess.current = isApproveSuccess;
  }, [isApprovePending, isApproveSuccess, toast]);

  // ── Toast emission: Deposit ────────────────────────────────────────────
  const prevDepositIsPending = useRef(false);
  const prevDepositIsSuccess = useRef(false);
  const prevDepositError = useRef<Error | null>(null);
  useEffect(() => {
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
  ]);

  // ── Toast emission: Claim ──────────────────────────────────────────────
  const prevClaimIsPending = useRef(false);
  const prevClaimIsSuccess = useRef(false);
  const prevClaimError = useRef<Error | null>(null);
  useEffect(() => {
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
  }, [claim.isPending, claim.isSuccess, claim.error, toast]);

  // When a deposit request becomes active (PendingVerification or PendingClaim),
  // copy its amount into the input so the displayed value matches what's already
  // committed on-chain. Do not auto-clear the input when the request resolves —
  // leave whatever the user last sees for the next flow.
  //
  // Guards:
  //   - isAmountLocked: only sync while locked; no-op when editable.
  //   - decimals: format requires decimals; defer until available (avoids "—").
  //   - activeRequest: type-narrowing guard (isAmountLocked implies non-null,
  //     but TypeScript doesn't know that).
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
  const onQuickAmount = useCallback(
    (idx: number) => {
      // Belt-and-suspenders: a locked chip's disabled HTML attribute already
      // suppresses the click, but guard here too so a stale event cannot
      // mutate amountInput while a request is in flight.
      if (isAmountLocked) return;
      if (decimals === undefined) return;
      if (idx === 0 && minDeposit !== undefined) {
        // Min chip — use the live minDeposit value.
        setAmountInput(formatUsdc(minDeposit, decimals).replace(/,/g, ""));
        return;
      }
      if (idx === 1) setAmountInput("5000");
      else if (idx === 2) setAmountInput("10000");
      else if (idx === 3 && balance !== undefined) {
        // Max chip — use the live balance.
        setAmountInput(formatUsdc(balance, decimals).replace(/,/g, ""));
      }
    },
    [decimals, minDeposit, balance, isAmountLocked],
  );

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[var(--color-pipeline-paper)] text-[color:var(--color-pipeline-ink)]">
      {/* Centred narrow column — mirrors Figma's centred single-column layout
          for the deposit / conversion screen. py-12 gives breathing room under
          the TopBar; gap-6 (24px) matches the vertical spacing between sections. */}
      <main className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-12">
        {/* Section header: PLUSD coin icon + "1:1 Conversion" heading */}
        <DepositHeader title="1:1 Conversion" />

        {/* Conversion card: USDC input + PLUSD output + info rows */}
        <ConversionCard
          input={{
            token: "usdc",
            tokenLabel: "USDC",
            // formattedBalance from useToken is "$1,000.00" (USD currency format).
            // Strip the leading "$" — the token label ("USDC") already establishes
            // the unit, so the balance line should show a plain decimal number.
            // Fall back to "—" while loading.
            balanceLabel: formattedBalance
              ? formattedBalance.replace(/^\$/, "")
              : "—",
            placeholderValue: "0",
            // Controlled value state
            value: amountInput,
            onValueChange: setAmountInput,
            // Also disable when the amount is locked to an active on-chain request.
            disabled: !isConnected || !isReady || isAmountLocked,
            // Fade the USDC value container once the allowance is approved and
            // step 2 is live. Purely visual — input remains editable. Figma: opacity-30.
            // Transition smooths the state change.
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
          }}
          output={{
            token: "plusd",
            tokenLabel: "PLUSD",
            balanceLabel: "0.00",
            // 1:1 conversion rate — echo the input (empty → "0")
            value: amountInput || "0",
          }}
          exchangeRate="1 USDC = 1 PLUSD"
          // Network fee is not estimated in this issue — leave as dash rather
          // than rendering stale/fake placeholder copy.
          networkFee="—"
        />

        {/* Conditional: unreachable-contract banner, low-balance banner, OR three-step card */}
        {isManagerUnreachable ? (
          /* DepositManager not reachable — replaces StepsCard.
             Shown only when connected and the contract read has settled
             with both addresses undefined. */
          <Card
            className="border-[color:var(--color-pipeline-danger)] bg-[var(--color-pipeline-danger)] text-[color:var(--color-pipeline-on-danger)]"
            data-testid="dm-unreachable-banner"
          >
            <p className="font-[family-name:var(--font-display)] text-[length:var(--text-pipeline-heading-s)]">
              DepositManager not reachable
            </p>
            <p className="mt-1 font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-caption)]">
              Check <code>VITE_DEPOSIT_MANAGER_ADDRESS</code> and RPC
              connectivity.
            </p>
          </Card>
        ) : hasBalance === false ? (
          /* Insufficient-balance banner — replaces StepsCard.
             Figma: node 1825-10214.
             Layout: horizontal flex-row with text-stack on left and
             Copy Address button pinned to the right. Background: yellow
             promo surface (same token as the home Connect Wallet card). */
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
        ) : (
          /* Three-step card: Approve → Confirm → Claim
             Figma: node 1498-100812 */
          <StepsCard
            steps={[
              {
                label: "Allow Pipeline to use USDC",
                actionLabel: "Approve",
                // Step 1 is disabled when canApprove is false or request exists.
                disabled: !canApprove,
                loading: isApprovePending,
                state: step1State,
                onAction: () => approve?.(amountBig),
              },
              {
                label: "Confirm USDC transfer",
                actionLabel: "Confirm",
                disabled: !canConfirm,
                // loading covers three situations:
                // 1. wagmi write in-flight (this session)
                // 2. API reports PendingVerification (verifier still working,
                //    possibly from a prior session)
                // 3. Brief post-success window before API picks up the new request
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
        )}
      </main>
    </div>
  );
}

export const Route = createFileRoute("/deposit")({
  component: Deposit,
});
