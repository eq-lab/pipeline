import { useState, useCallback, useEffect, useRef } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { parseUsdc } from "@/lib/usdc";
import {
  Button,
  Card,
  ErrorDetailsDialog,
  InfoRow,
  SegmentedTabs,
  StakeHeader,
  StepsCard,
  TokenAmountDisplay,
  TokenInput,
} from "@pipeline/ui";
import { useWalletView, useConnectModal } from "@/wallet";
import { XlmFundingBanner } from "@/components/XlmFundingBanner";
import { useToast } from "@/lib/toast";
import { useStakeFlow } from "@/wallet/useStakeFlow";
import { toUserError } from "@/utils/userError";

/** Active tab of the stake page; also the `?tab=` search-param value. */
type StakeTab = "stake" | "unstake";

// spec: docs/frontend/dashboard-components.md#stake-route
// (step sequences per chain/tab, toast id scoping, Figma refs).

function Stake() {
  // ── Chain view ────────────────────────────────────────────────────────
  const { kind } = useWalletView();
  const isStellar = kind === "stellar";

  // ── Toast ─────────────────────────────────────────────────────────────
  const toast = useToast();

  // ── Connect modal ────────────────────────────────────────────────────
  const { open: openConnectModal } = useConnectModal();

  // ── Initial tab from the URL ──────────────────────────────────────────
  // spec: docs/frontend/dashboard-components.md#stake-route (URL contract)
  const { tab: initialTab } = Route.useSearch();

  // ── Local state ───────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<StakeTab>(initialTab);
  const [amountInput, setAmountInput] = useState("");
  // Page-level ErrorDetailsDialog state (#1034) — mirrors routes/deposit.tsx.
  // spec: docs/frontend/error-handling.md
  const [errorDialog, setErrorDialog] = useState<{
    message: string;
    details: string;
  } | null>(null);

  const isStakeTab = activeTab === "stake";

  // ── Parse amount (two-pass lastDecimals pattern from deposit.tsx) ─────
  const [lastDecimals, setLastDecimals] = useState<number | undefined>(
    undefined,
  );
  const amountBig = parseUsdc(amountInput, lastDecimals);

  // ── Flow adapter ──────────────────────────────────────────────────────
  const flow = useStakeFlow(activeTab, amountBig, setAmountInput);

  // Update lastDecimals whenever flow.decimals changes.
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

  // ── Balance refetch after write success ───────────────────────────────
  const { refetchBalances } = flow;
  const step2TxIsSuccess = flow.step2Tx.isSuccess;
  useEffect(() => {
    if (step2TxIsSuccess) refetchBalances();
  }, [step2TxIsSuccess, refetchBalances]);

  // ── Toast: step 1 (EVM approve / Stellar trustline) ───────────────────
  const prevStep1IsPending = useRef(false);
  const prevStep1IsSuccess = useRef(false);
  const prevStep1Error = useRef<Error | null>(null);
  useEffect(() => {
    const toastId = isStellar
      ? isStakeTab
        ? "stellar-splusd-trust-tx"
        : "stellar-plusd-trust-tx"
      : isStakeTab
        ? "stake-approve-tx"
        : ""; // EVM unstake has no step 1

    if (!toastId) return;

    const pendingTitle = isStellar
      ? isStakeTab
        ? "Enabling sPLUSD trustline…"
        : "Enabling PLUSD trustline…"
      : "Approving PLUSD…";
    const successTitle = isStellar
      ? isStakeTab
        ? "sPLUSD trustline enabled"
        : "PLUSD trustline enabled"
      : "Approval confirmed";
    const genericFailureTitle = isStellar
      ? isStakeTab
        ? "sPLUSD trustline failed"
        : "PLUSD trustline failed"
      : "Approval failed";

    if (flow.step1Tx.isPending && !prevStep1IsPending.current) {
      toast.show({ id: toastId, tone: "pending", title: pendingTitle });
    }
    if (flow.step1Tx.isSuccess && !prevStep1IsSuccess.current) {
      toast.update(toastId, { tone: "success", title: successTitle });
    }
    // spec: docs/frontend/error-handling.md#toast-title-rule — added by
    // #1034 (this branch did not exist before; step 1 failures were
    // console-error-only).
    if (flow.step1Tx.error && flow.step1Tx.error !== prevStep1Error.current) {
      console.error(
        isStellar
          ? isStakeTab
            ? "sPLUSD trustline failed:"
            : "PLUSD trustline failed:"
          : "Approval failed:",
        flow.step1Tx.error,
      );
      const mapped = toUserError(flow.step1Tx.error);
      toast.update(toastId, {
        tone: "danger",
        title: mapped.isSpecific ? mapped.message : genericFailureTitle,
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
    prevStep1IsPending.current = flow.step1Tx.isPending;
    prevStep1IsSuccess.current = flow.step1Tx.isSuccess;
    prevStep1Error.current = flow.step1Tx.error;
  }, [
    flow.step1Tx.isPending,
    flow.step1Tx.isSuccess,
    flow.step1Tx.error,
    toast,
    isStellar,
    isStakeTab,
  ]);

  // ── Toast: step 2 (stake/unstake) ─────────────────────────────────────
  const navigate = useNavigate();
  const lastActionAmountRef = useRef<string>("");
  const prevStep2IsPending = useRef(false);
  const prevStep2IsSuccess = useRef(false);
  const prevStep2Error = useRef<Error | null>(null);
  useEffect(() => {
    const toastId = isStellar
      ? isStakeTab
        ? "stellar-stake-tx"
        : "stellar-unstake-tx"
      : isStakeTab
        ? "stake-tx"
        : "unstake-tx";

    if (flow.step2Tx.isPending && !prevStep2IsPending.current) {
      lastActionAmountRef.current = amountInput.trim();
      toast.show({
        id: toastId,
        tone: "pending",
        title: isStakeTab ? "Staking…" : "Unstaking…",
      });
    }
    if (flow.step2Tx.isSuccess && !prevStep2IsSuccess.current) {
      const amount = lastActionAmountRef.current;
      toast.update(toastId, {
        tone: "success",
        title: isStakeTab
          ? amount
            ? `Staked ${amount} PLUSD`
            : "Staked successfully"
          : amount
            ? `Unstaked ${amount} sPLUSD`
            : "Unstaked successfully",
      });
      void navigate({ to: "/" });
    }
    if (flow.step2Tx.error && flow.step2Tx.error !== prevStep2Error.current) {
      console.error(
        isStakeTab ? "Stake failed:" : "Unstake failed:",
        flow.step2Tx.error,
      );
      const mapped = toUserError(flow.step2Tx.error);
      toast.update(toastId, {
        tone: "danger",
        title: mapped.isSpecific
          ? mapped.message
          : isStakeTab
            ? "Stake failed"
            : "Unstake failed",
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
    isStellar,
    isStakeTab,
    amountInput,
    navigate,
  ]);

  // ── Tab-switch handler ─────────────────────────────────────────────────
  const onSelectTab = useCallback((next: string) => {
    setActiveTab(next as StakeTab);
    setAmountInput("");
  }, []);

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div
      data-testid="stake-page-root"
      className="min-h-screen bg-[var(--color-pipeline-paper)] text-[color:var(--color-pipeline-ink)]"
    >
      {/* Centred narrow column */}
      <main
        data-testid="stake-main"
        className="mx-auto flex w-full max-w-lg flex-col gap-8 px-4 py-12"
      >
        {/* Section header */}
        {/* TODO(#APR-followup): wire live yield rate; out of scope for #310 */}
        <StakeHeader data-testid="stake-header" title="Earn 8.42% p.a." />

        {/* Combined conversion card: tab switcher + input + output/rates */}
        <Card
          variant="white"
          padding="none"
          data-testid="stake-conversion-card"
          className="flex flex-col gap-0 overflow-hidden"
        >
          {/* Input sub-section */}
          <div
            data-testid="stake-input-section"
            className="flex flex-col gap-0.5 p-4"
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
                flow.formattedInputBalance ? flow.formattedInputBalance : "—"
              }
              placeholderValue="0"
              value={amountInput}
              onValueChange={setAmountInput}
              disabled={flow.isInputDisabled}
              quickAmounts={[
                { label: "25%" },
                { label: "50%" },
                { label: "75%" },
                { label: "Max" },
              ]}
              onQuickAmountClick={flow.onQuickAmount}
            />
          </div>

          {/* Output sub-section */}
          <div
            data-testid="stake-output-section"
            className="flex flex-col gap-4 p-4"
          >
            {/* Strip card chrome so the component renders flush. */}
            <TokenAmountDisplay
              token={isStakeTab ? "splusd" : "plusd"}
              tokenLabel={isStakeTab ? "sPLUSD" : "PLUSD"}
              balanceLabel={
                flow.formattedOutputBalance ? flow.formattedOutputBalance : "—"
              }
              value={flow.previewOutputValue}
              style={{
                border: "none",
                background: "transparent",
                borderRadius: 0,
                padding: 0,
              }}
            />
            <InfoRow label="Exchange rate" value={flow.exchangeRateText} />
            <InfoRow label="Network fee" value={flow.networkFee ?? "—"} />
          </div>
        </Card>

        {/* Steps card — conditional on wallet connection. Figma node 1994-7226 (banner). */}
        {!flow.isConnected ? (
          <Card
            variant="yellow"
            data-testid="connect-wallet-banner"
            className="flex flex-row items-center justify-between gap-4 !border-t !border-r-[3px] !border-b-[3px] !border-l shadow-sm"
          >
            <p
              data-testid="stake-connect-message"
              className="font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-body)]"
            >
              Connect your wallet first
            </p>
            <Button
              variant="primary-dark"
              size="compact"
              data-testid="stake-connect-button"
              className="whitespace-nowrap"
              onClick={openConnectModal}
            >
              Connect
            </Button>
          </Card>
        ) : isStellar && flow.needsXlmFunding ? (
          <XlmFundingBanner address={flow.address} />
        ) : (
          <StepsCard
            data-testid={
              isStakeTab ? "stake-steps-card" : "stake-unstake-steps"
            }
            steps={flow.steps}
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

export const Route = createFileRoute("/stake")({
  validateSearch: (raw): { tab: StakeTab } => ({
    tab: raw?.tab === "unstake" ? "unstake" : "stake",
  }),
  component: Stake,
});
