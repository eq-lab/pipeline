// spec: docs/frontend/bank-transfers.md#wire-out
import { useEffect, useRef, useState } from "react";
import { InlineError, ModalDialog, StepsCard, TokenInput } from "@pipeline/ui";
import type { FlowState } from "@/wallet";
import { useWalletView } from "@/wallet";
import { useToast } from "@/lib/toast";
import { formatUsdc, formatUsdcInput } from "@/lib/usdc";
import { balanceChipAmount } from "@/utils/quickAmount";
import { toUserError } from "@/utils/userError";
import {
  WIRE_OUT_ABOVE_BALANCE_REASON,
  useWireOutFlow,
} from "./useWireOutFlow";
import { useKybPassed } from "./useWireOutSection";

const TOAST_ID = "wire-out-tx";
const QUICK_AMOUNTS = ["25%", "50%", "75%", "Max"];

export interface ErrorDetails {
  message: string;
  details: string;
}

interface WireOutModalProps {
  open: boolean;
  onClose: () => void;
  flow: Pick<
    FlowState,
    | "balance"
    | "decimals"
    | "formattedBalance"
    | "plusdAuthorized"
    | "refetchBalance"
  >;
  onSubmitted: (wireOutId: string | undefined) => void;
  onShowErrorDetails: (details: ErrorDetails) => void;
}

export function WireOutModal({
  open,
  onClose,
  flow,
  onSubmitted,
  onShowErrorDetails,
}: WireOutModalProps) {
  const { kind } = useWalletView();
  const toast = useToast();
  const kybPassed = useKybPassed();
  const [amountInput, setAmountInput] = useState("");
  const wireOut = useWireOutFlow({
    kind,
    amountInput,
    balance: flow.balance,
    decimals: flow.decimals,
    plusdAuthorized: flow.plusdAuthorized,
    kybPassed,
  });

  const { isPending, isSuccess, lastWireOutId, reset } = wireOut;
  const errorStep = wireOut.steps.find((step) => step.state === "error");
  const errorMessage = errorStep?.errorMessage;
  const errorDetails = errorStep?.errorDetails;

  const lastAmountRef = useRef("");
  const prevPending = useRef(false);
  const prevSuccess = useRef(false);
  const prevErrorDetails = useRef<string | undefined>(undefined);
  const { refetchBalance } = flow;

  useEffect(() => {
    if (isPending && !prevPending.current) {
      lastAmountRef.current = amountInput.trim();
      toast.show({ id: TOAST_ID, tone: "pending", title: "Sending…" });
    }
    if (isSuccess && !prevSuccess.current) {
      toast.update(TOAST_ID, {
        tone: "success",
        title: lastAmountRef.current
          ? `Wire-out of ${lastAmountRef.current} PLUSD requested`
          : "Wire-out requested",
      });
      onSubmitted(lastWireOutId);
      refetchBalance();
      setAmountInput("");
      onClose();
      reset();
    }
    if (
      errorDetails !== undefined &&
      errorDetails !== prevErrorDetails.current &&
      errorMessage !== undefined
    ) {
      const mapped = toUserError(new Error(errorDetails), {
        context: "wireOut",
      });
      toast.update(TOAST_ID, {
        tone: "danger",
        title: mapped.isSpecific ? errorMessage : "Wire-out failed",
        action: {
          label: "Details",
          onClick: () =>
            onShowErrorDetails({
              message: errorMessage,
              details: errorDetails,
            }),
        },
      });
    }
    prevPending.current = isPending;
    prevSuccess.current = isSuccess;
    prevErrorDetails.current = errorDetails;
  }, [
    isPending,
    isSuccess,
    lastWireOutId,
    errorMessage,
    errorDetails,
    amountInput,
    toast,
    onSubmitted,
    onClose,
    onShowErrorDetails,
    refetchBalance,
    reset,
  ]);

  const onQuickAmount = (index: number) => {
    if (flow.balance === undefined || flow.decimals === undefined) return;
    const next = balanceChipAmount(flow.balance, index);
    if (next !== undefined)
      setAmountInput(formatUsdcInput(next, flow.decimals));
  };

  const balanceLabel =
    flow.balance !== undefined ? formatUsdc(flow.balance, flow.decimals) : "—";
  const inputDisabled = isPending || flow.balance === undefined;

  return (
    <ModalDialog
      open={open}
      title="Withdraw to a bank account"
      onClose={onClose}
      data-testid="wire-out-modal"
    >
      <div className="flex flex-col gap-3">
        <TokenInput
          token="plusd"
          tokenLabel="PLUSD"
          inputTestId="wire-out-amount-input"
          data-testid="wire-out-token-input"
          balanceLabel={balanceLabel}
          placeholderValue="0"
          value={amountInput}
          onValueChange={setAmountInput}
          disabled={inputDisabled}
          quickAmounts={QUICK_AMOUNTS.map((label) => ({
            label,
            disabled: inputDisabled,
          }))}
          onQuickAmountClick={onQuickAmount}
        />
        {wireOut.exceedsBalance && (
          <InlineError
            message={WIRE_OUT_ABOVE_BALANCE_REASON}
            className="self-end"
          />
        )}
        <StepsCard data-testid="wire-out-steps-card" steps={wireOut.steps} />
      </div>
    </ModalDialog>
  );
}
