import { useState, useCallback, useEffect, useRef } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Card,
  ConversionCard,
  DepositHeader,
  StepsCard,
  Button,
  ErrorDetailsDialog,
} from "@pipeline/ui";
import { useDepositFlow, useWalletView, useConnectModal } from "@/wallet";
import { parseUsdc, formatUsdc, formatUsdcWhole } from "@/lib/usdc";
import { useToast } from "@/lib/toast";
import { toUserError } from "@/utils/userError";

// spec: docs/frontend/dashboard-components.md#deposit-and-withdraw-route
// (URL contract, step sequences per chain/direction, toast id scoping, Figma refs).

// ── Types ─────────────────────────────────────────────────────────────────────

type Direction = "deposit" | "withdraw";

// ── Route ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/deposit")({
  validateSearch: (raw): { direction: Direction } => ({
    direction: raw?.direction === "withdraw" ? "withdraw" : "deposit",
  }),
  component: Deposit,
});

// ── Component ─────────────────────────────────────────────────────────────────

function Deposit() {
  // ── Direction ─────────────────────────────────────────────────────────
  const { direction } = Route.useSearch();
  const isDeposit = direction === "deposit";

  // ── Toast + navigation ────────────────────────────────────────────────
  const toast = useToast();
  const navigate = useNavigate();

  // ── Chain view ────────────────────────────────────────────────────────
  const { kind } = useWalletView();
  const isStellar = kind === "stellar";

  // ── Local state ───────────────────────────────────────────────────────
  const [amountInput, setAmountInput] = useState("");
  const [copied, setCopied] = useState(false);
  // Page-level ErrorDetailsDialog state (#1034) — a danger toast's "Details"
  // action opens this dialog, which outlives the toast's 5s auto-dismiss.
  // spec: docs/frontend/error-handling.md
  const [errorDialog, setErrorDialog] = useState<{
    message: string;
    details: string;
  } | null>(null);
  // `request_id` of a completed deposit the page has already reset for. Gates
  // the auto-reset effect so it fires once per completed deposit.
  const [dismissedDepositId, setDismissedDepositId] = useState<
    string | undefined
  >(undefined);

  // ── Parse amount (needs decimals — use 6 as default until flow loads) ──
  // The flow's decimals are used for proper parsing, but we need amountBig
  // to pass INTO the flow. We'll use a two-pass approach: compute amountBig
  // with the decimals from a previous render. This is safe — if decimals
  // change (chain switch), the amount input resets anyway.
  const [lastDecimals, setLastDecimals] = useState<number | undefined>(
    undefined,
  );
  const amountBig = parseUsdc(amountInput, lastDecimals);

  // ── Flow adapter ──────────────────────────────────────────────────────
  const flow = useDepositFlow(
    direction,
    amountBig,
    setAmountInput,
    dismissedDepositId,
  );

  // Latch the first successful data load. The bottom section is hidden while
  // chain/API data is still pending — but only on the *first* page load. Once
  // data has resolved while connected, keep the section mounted through later
  // background refetches; otherwise it re-hides on every refetch and flickers.
  const hasLoadedDataRef = useRef(false);
  if (flow.isConnected && !flow.isDataPending) {
    hasLoadedDataRef.current = true;
  }
  // Render nothing only during the initial load, before data first resolves.
  const isInitialDataLoad = flow.isDataPending && !hasLoadedDataRef.current;

  // ── Auto-reset once a deposit settles to `Completed` ──────────────────
  // spec: docs/frontend/wallet-flows.md#request-state-model
  const {
    isDepositCompleted,
    depositCompletedRequestId,
    reset: resetFlow,
  } = flow;
  useEffect(() => {
    if (isDepositCompleted) {
      setDismissedDepositId(depositCompletedRequestId);
      setAmountInput("");
      resetFlow();
    }
  }, [isDepositCompleted, depositCompletedRequestId, resetFlow]);

  // ── Connect modal (shared single instance via ConnectModalProvider) ───
  const { open: openConnectModal } = useConnectModal();

  // Update lastDecimals whenever flow.decimals changes
  useEffect(() => {
    if (flow.decimals !== undefined) {
      setLastDecimals(flow.decimals);
    }
  }, [flow.decimals]);

  // ── Reset amount on chain switch ─────────────────────────────────────
  const prevKindRef = useRef(kind);
  useEffect(() => {
    if (prevKindRef.current !== kind) {
      setAmountInput("");
      prevKindRef.current = kind;
    }
  }, [kind]);

  // ── Amount sync: lock input to active request amount ─────────────────
  useEffect(() => {
    if (!flow.isAmountLocked) return;
    if (flow.decimals === undefined) return;
    if (!flow.lockedAmountRaw) return;
    const formatted = formatUsdc(flow.lockedAmountRaw, flow.decimals).replace(
      /,/g,
      "",
    );
    setAmountInput(formatted);
  }, [flow.isAmountLocked, flow.lockedAmountRaw, flow.decimals]);

  // ── Refetch balance after success ─────────────────────────────────────
  const { refetchBalance } = flow;
  const step2TxIsSuccess = flow.step2Tx.isSuccess;
  const step3TxIsSuccess = flow.step3Tx.isSuccess;
  useEffect(() => {
    if (step3TxIsSuccess) refetchBalance();
  }, [step3TxIsSuccess, refetchBalance]);

  useEffect(() => {
    if (step2TxIsSuccess) refetchBalance();
  }, [step2TxIsSuccess, refetchBalance]);

  // ── Toast: step 1 (EVM approve only) ─────────────────────────────────
  const prevStep1IsPending = useRef(false);
  const prevStep1IsSuccess = useRef(false);
  useEffect(() => {
    // On Stellar, trustline toasts are emitted per-asset below.
    if (isStellar) return;

    const toastId = isDeposit ? "approve-tx" : "withdraw-approve-tx";
    const pendingTitle = isDeposit ? "Approving USDC…" : "Approving PLUSD…";

    if (flow.step1Tx.isPending && !prevStep1IsPending.current) {
      toast.show({ id: toastId, tone: "pending", title: pendingTitle });
    }
    if (flow.step1Tx.isSuccess && !prevStep1IsSuccess.current) {
      toast.update(toastId, { tone: "success", title: "Approval confirmed" });
    }
    prevStep1IsPending.current = flow.step1Tx.isPending;
    prevStep1IsSuccess.current = flow.step1Tx.isSuccess;
  }, [
    flow.step1Tx.isPending,
    flow.step1Tx.isSuccess,
    toast,
    direction,
    isStellar,
    isDeposit,
  ]);

  // ── Toast: Stellar PLUSD trustline ────────────────────────────────────
  const prevPlusdTrustPending = useRef(false);
  const prevPlusdTrustSuccess = useRef(false);
  const plusdTrustline = flow.trustlines[0];
  useEffect(() => {
    if (!isStellar || !plusdTrustline) return;
    const toastId = "stellar-trust-plusd-tx";
    if (plusdTrustline.tx.isPending && !prevPlusdTrustPending.current) {
      toast.show({
        id: toastId,
        tone: "pending",
        title: "Enabling PLUSD trustline…",
      });
    }
    if (plusdTrustline.tx.isSuccess && !prevPlusdTrustSuccess.current) {
      toast.update(toastId, {
        tone: "success",
        title: "PLUSD trustline enabled",
      });
    }
    prevPlusdTrustPending.current = plusdTrustline.tx.isPending;
    prevPlusdTrustSuccess.current = plusdTrustline.tx.isSuccess;
  }, [
    plusdTrustline?.tx.isPending,
    plusdTrustline?.tx.isSuccess,
    toast,
    isStellar,
    plusdTrustline,
  ]);

  // ── Toast: Stellar USDC trustline ─────────────────────────────────────
  const prevUsdcTrustPending = useRef(false);
  const prevUsdcTrustSuccess = useRef(false);
  const usdcTrustline = flow.trustlines[1];
  useEffect(() => {
    if (!isStellar || !usdcTrustline) return;
    const toastId = "stellar-trust-usdc-tx";
    if (usdcTrustline.tx.isPending && !prevUsdcTrustPending.current) {
      toast.show({
        id: toastId,
        tone: "pending",
        title: "Enabling USDC trustline…",
      });
    }
    if (usdcTrustline.tx.isSuccess && !prevUsdcTrustSuccess.current) {
      toast.update(toastId, {
        tone: "success",
        title: "USDC trustline enabled",
      });
    }
    prevUsdcTrustPending.current = usdcTrustline.tx.isPending;
    prevUsdcTrustSuccess.current = usdcTrustline.tx.isSuccess;
  }, [
    usdcTrustline?.tx.isPending,
    usdcTrustline?.tx.isSuccess,
    toast,
    isStellar,
    usdcTrustline,
  ]);

  // ── Toast: step 2 (request) ───────────────────────────────────────────
  const prevStep2IsPending = useRef(false);
  const prevStep2IsSuccess = useRef(false);
  const prevStep2Error = useRef<Error | null>(null);
  useEffect(() => {
    const toastId = isStellar
      ? isDeposit
        ? "stellar-deposit-tx"
        : "stellar-withdraw-tx"
      : isDeposit
        ? "deposit-tx"
        : "withdraw-tx";

    if (flow.step2Tx.isPending && !prevStep2IsPending.current) {
      toast.show({ id: toastId, tone: "pending", title: "Sending…" });
    }
    if (flow.step2Tx.isSuccess && !prevStep2IsSuccess.current) {
      toast.update(toastId, {
        tone: "success",
        title: isDeposit ? "Deposit submitted" : "Withdrawal submitted",
        action: {
          label: "View",
          onClick: () => void navigate({ to: "/transactions" }),
        },
      });
    }
    if (flow.step2Tx.error && flow.step2Tx.error !== prevStep2Error.current) {
      console.error(
        isDeposit ? "Deposit failed:" : "Withdrawal failed:",
        flow.step2Tx.error,
      );
      // spec: docs/frontend/error-handling.md#toast-title-rule — use the
      // mapped specific message as the toast title when recognised,
      // otherwise keep the hardcoded generic title. The raw payload never
      // reaches the toast; a "Details" action opens the page-level dialog.
      // Re-mapped here (not read from `flow.step2Tx.userError`) so the
      // effect's dependency array only needs the stable `error` reference.
      const mapped = toUserError(flow.step2Tx.error);
      toast.update(toastId, {
        tone: "danger",
        title: mapped.isSpecific
          ? mapped.message
          : isDeposit
            ? "Deposit failed"
            : "Withdrawal failed",
        action: {
          label: "Details",
          onClick: () =>
            setErrorDialog({
              message: mapped.message,
              details: mapped.details,
            }),
        },
      });
    }
    prevStep2IsPending.current = flow.step2Tx.isPending;
    prevStep2IsSuccess.current = flow.step2Tx.isSuccess;
    prevStep2Error.current = flow.step2Tx.error;
  }, [
    flow.step2Tx.isPending,
    flow.step2Tx.isSuccess,
    flow.step2Tx.error,
    toast,
    navigate,
    direction,
    isStellar,
    isDeposit,
  ]);

  // ── Toast: step 3 (claim) ─────────────────────────────────────────────
  // Track the most recent locked request amount so the claim toast can show
  // the claimed amount even after the flow resets on completion.
  const lastClaimAmountRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (flow.lockedAmountRaw && flow.decimals !== undefined) {
      lastClaimAmountRef.current = formatUsdc(
        flow.lockedAmountRaw,
        flow.decimals,
      );
    }
  }, [flow.lockedAmountRaw, flow.decimals]);

  const prevStep3IsPending = useRef(false);
  const prevStep3IsSuccess = useRef(false);
  const prevStep3Error = useRef<Error | null>(null);
  useEffect(() => {
    const toastId = isStellar
      ? isDeposit
        ? "stellar-deposit-claim-tx"
        : "stellar-withdraw-claim-tx"
      : isDeposit
        ? "claim-tx"
        : "withdraw-claim-tx";

    if (flow.step3Tx.isPending && !prevStep3IsPending.current) {
      toast.show({ id: toastId, tone: "pending", title: "Claiming…" });
    }
    if (flow.step3Tx.isSuccess && !prevStep3IsSuccess.current) {
      const claimedAmount = lastClaimAmountRef.current;
      toast.update(toastId, {
        tone: "success",
        // spec: docs/frontend/dashboard-components.md#deposit-and-withdraw-route (claim toast)
        title: isDeposit
          ? claimedAmount
            ? `+${claimedAmount} PLUSD`
            : "PLUSD claimed"
          : "USDC claimed",
        action: isDeposit
          ? {
              label: "Stake",
              onClick: () =>
                void navigate({ to: "/stake", search: { tab: "stake" } }),
            }
          : undefined,
      });
    }
    if (flow.step3Tx.error && flow.step3Tx.error !== prevStep3Error.current) {
      console.error("Claim failed:", flow.step3Tx.error);
      const mapped = toUserError(flow.step3Tx.error);
      toast.update(toastId, {
        tone: "danger",
        title: mapped.isSpecific ? mapped.message : "Claim failed",
        action: {
          label: "Details",
          onClick: () =>
            setErrorDialog({
              message: mapped.message,
              details: mapped.details,
            }),
        },
      });
    }
    prevStep3IsPending.current = flow.step3Tx.isPending;
    prevStep3IsSuccess.current = flow.step3Tx.isSuccess;
    prevStep3Error.current = flow.step3Tx.error;
  }, [
    flow.step3Tx.isPending,
    flow.step3Tx.isSuccess,
    flow.step3Tx.error,
    toast,
    navigate,
    direction,
    isStellar,
    isDeposit,
  ]);

  // ── Copy address handler ──────────────────────────────────────────────
  const copyAddress = useCallback(() => {
    const addr = flow.address;
    if (!addr || typeof navigator === "undefined" || !navigator.clipboard)
      return;
    navigator.clipboard.writeText(addr).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {
        /* Silently no-op when clipboard write fails. */
      },
    );
  }, [flow.address]);

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

  // plusdTrustline / usdcTrustline are already declared above for toast logic.

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[var(--color-pipeline-paper)] text-[color:var(--color-pipeline-ink)]">
      <main className="mx-auto flex w-full max-w-lg flex-col gap-6 px-2 py-12 md:px-4">
        {/* Section header */}
        <DepositHeader data-testid="deposit-header" title="1:1 Conversion" />

        {/* Conversion card */}
        <ConversionCard
          data-testid={
            isDeposit ? "deposit-conversion-card" : "withdraw-conversion-card"
          }
          input={
            isDeposit
              ? {
                  token: "usdc",
                  tokenLabel: "USDC",
                  inputTestId: "deposit-amount-input",
                  balanceLabel: flow.formattedBalance
                    ? flow.formattedBalance.replace(/^\$/, "")
                    : "—",
                  placeholderValue: "0",
                  value: amountInput,
                  onValueChange: setAmountInput,
                  disabled:
                    !flow.isConnected || !flow.isReady || flow.isAmountLocked,
                  className: flow.isInputFaded
                    ? "opacity-30 focus-within:opacity-100 transition-opacity"
                    : "transition-opacity",
                  quickAmounts: [
                    {
                      label: flow.minChipLabel,
                      disabled: flow.isAmountLocked,
                    },
                    { label: "$5,000", disabled: flow.isAmountLocked },
                    { label: "$10,000", disabled: flow.isAmountLocked },
                    { label: "Max", disabled: flow.isAmountLocked },
                  ],
                  onQuickAmountClick: flow.onQuickAmount,
                }
              : {
                  token: "plusd",
                  tokenLabel: "PLUSD",
                  inputTestId: "withdraw-amount-input",
                  balanceLabel: flow.formattedBalance
                    ? flow.formattedBalance.replace(/^\$/, "")
                    : "—",
                  placeholderValue: "0",
                  value: amountInput,
                  onValueChange: setAmountInput,
                  disabled:
                    !flow.isConnected || !flow.isReady || flow.isAmountLocked,
                  className: flow.isInputFaded
                    ? "opacity-30 focus-within:opacity-100 transition-opacity"
                    : "transition-opacity",
                  quickAmounts: [
                    { label: "25%", disabled: flow.isAmountLocked },
                    { label: "50%", disabled: flow.isAmountLocked },
                    { label: "75%", disabled: flow.isAmountLocked },
                    { label: "Max", disabled: flow.isAmountLocked },
                  ],
                  onQuickAmountClick: flow.onQuickAmount,
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
          networkFee={flow.networkFee ?? "—"}
          onSwap={flow.isAnyTxInFlight ? undefined : onSwap}
        />

        {/* spec: docs/frontend/dashboard-components.md#deposit-and-withdraw-route (banner precedence) */}
        {!flow.isConnected ? (
          <Card
            variant="yellow"
            data-testid="connect-wallet-banner"
            className="flex flex-row items-center justify-between gap-4 !border-t !border-r-[3px] !border-b-[3px] !border-l"
          >
            <p
              data-testid="connect-wallet-banner-text"
              className="font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-body)]"
            >
              Connect your wallet first
            </p>
            <Button
              data-testid="connect-wallet-banner-action"
              variant="primary-dark"
              size="compact"
              className="whitespace-nowrap"
              onClick={openConnectModal}
            >
              Connect
            </Button>
          </Card>
        ) : isInitialDataLoad ? null : isStellar &&
          isDeposit &&
          usdcTrustline?.needsTrustline &&
          flow.hasBalance === false ? (
          <Card
            variant="yellow"
            data-testid="usdc-trustline-banner"
            className="flex flex-row items-center justify-between gap-4"
          >
            <div
              data-testid="usdc-trustline-banner-text"
              className="flex flex-col items-start gap-1"
            >
              <p
                data-testid="usdc-trustline-banner-title"
                className="font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-body)]"
              >
                Add USDC trustline
              </p>
              <p
                data-testid="usdc-trustline-banner-subtitle"
                className="font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-caption)] text-[color:var(--color-pipeline-ink-muted)]"
              >
                Required to hold and deposit USDC on Stellar
              </p>
            </div>
            <Button
              data-testid="usdc-trustline-banner-action"
              variant="primary-dark"
              className="whitespace-nowrap"
              onClick={() => usdcTrustline?.onEnable()}
              disabled={usdcTrustline?.enabling}
            >
              {usdcTrustline?.enabling ? "Adding…" : "Add trustline"}
            </Button>
          </Card>
        ) : isDeposit && flow.hasBalance === false ? (
          <Card
            variant="yellow"
            data-testid="low-balance-banner"
            className="flex flex-row items-center justify-between gap-4"
          >
            <div
              data-testid="low-balance-banner-text"
              className="flex flex-col items-start gap-1"
            >
              <p
                data-testid="low-balance-banner-title"
                className="font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-body)]"
              >
                Add funds to your USDC balance
              </p>
              <p
                data-testid="low-balance-banner-minimum"
                className="font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-caption)] text-[color:var(--color-pipeline-ink-muted)]"
              >
                Minimum amount —{" "}
                {flow.minDeposit !== undefined && flow.decimals !== undefined
                  ? `${formatUsdcWhole(flow.minDeposit, flow.decimals)} USDC`
                  : "—"}
              </p>
            </div>
            <Button
              data-testid="low-balance-banner-action"
              variant="primary-dark"
              className="whitespace-nowrap"
              onClick={copyAddress}
              disabled={!flow.address}
            >
              {copied ? "Copied" : "Copy Address"}
            </Button>
          </Card>
        ) : isStellar && flow.trustlines.length === 2 ? (
          <StepsCard
            data-testid={
              isDeposit ? "deposit-steps-card" : "withdraw-steps-card"
            }
            steps={[
              {
                label: "Enable USDC",
                actionLabel: "Enable",
                state: usdcTrustline?.isEnabled ? "success" : "idle",
                loading: usdcTrustline?.enabling ?? false,
                disabled:
                  (usdcTrustline?.isEnabled ?? false) ||
                  (usdcTrustline?.enabling ?? false) ||
                  !flow.isConnected,
                onAction: usdcTrustline?.onEnable,
              },
              {
                label: "Enable PLUSD",
                actionLabel: "Enable",
                state: plusdTrustline?.isEnabled ? "success" : "idle",
                loading: plusdTrustline?.enabling ?? false,
                disabled:
                  (plusdTrustline?.isEnabled ?? false) ||
                  (plusdTrustline?.enabling ?? false) ||
                  !flow.isConnected,
                onAction: plusdTrustline?.onEnable,
              },
              {
                label: flow.step2.label,
                actionLabel: flow.step2.actionLabel,
                disabled: flow.step2.disabled,
                loading: flow.step2.loading,
                state: flow.step2.state,
                onAction: flow.step2.onAction,
                errorMessage: flow.step2.errorMessage,
                errorDetails: flow.step2.errorDetails,
              },
              {
                label: flow.step3.label,
                actionLabel: flow.step3.actionLabel,
                disabled: flow.step3.disabled,
                loading: flow.step3.loading,
                state: flow.step3.state,
                onAction: flow.step3.onAction,
                errorMessage: flow.step3.errorMessage,
                errorDetails: flow.step3.errorDetails,
              },
            ]}
          />
        ) : (
          <StepsCard
            data-testid={
              isDeposit ? "deposit-steps-card" : "withdraw-steps-card"
            }
            steps={[
              {
                label: flow.step1.label,
                actionLabel: flow.step1.actionLabel,
                disabled: flow.step1.disabled,
                loading: flow.step1.loading,
                state: flow.step1.state,
                onAction: flow.step1.onAction,
              },
              {
                label: flow.step2.label,
                actionLabel: flow.step2.actionLabel,
                disabled: flow.step2.disabled,
                loading: flow.step2.loading,
                state: flow.step2.state,
                onAction: flow.step2.onAction,
                errorMessage: flow.step2.errorMessage,
                errorDetails: flow.step2.errorDetails,
              },
              {
                label: flow.step3.label,
                actionLabel: flow.step3.actionLabel,
                disabled: flow.step3.disabled,
                loading: flow.step3.loading,
                state: flow.step3.state,
                onAction: flow.step3.onAction,
                errorMessage: flow.step3.errorMessage,
                errorDetails: flow.step3.errorDetails,
              },
            ]}
          />
        )}
      </main>
      <ErrorDetailsDialog
        open={errorDialog !== null}
        summary={errorDialog?.message}
        details={errorDialog?.details ?? ""}
        onClose={() => setErrorDialog(null)}
      />
    </div>
  );
}
