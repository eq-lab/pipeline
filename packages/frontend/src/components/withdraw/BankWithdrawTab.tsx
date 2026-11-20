// spec: docs/frontend/bank-transfers.md#wire-out
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Card, ConversionCard, InlineError, StepsCard } from "@pipeline/ui";
import type { FlowState } from "@/wallet";
import { useWalletView } from "@/wallet";
import { renderWireOutRow } from "@/components/activity/renderWireOutRow";
import { useToast } from "@/lib/toast";
import { formatUsdcInput } from "@/lib/usdc";
import { balanceChipAmount } from "@/utils/quickAmount";
import { toUserError } from "@/utils/userError";
import { WireOutInfoCard } from "./WireOutInfoCard";
import {
  WIRE_OUT_ABOVE_BALANCE_REASON,
  useWireOutFlow,
} from "./useWireOutFlow";
import { useKybPassed, useWireOutList } from "./useWireOutList";

const TOAST_ID = "wire-out-tx";
const QUICK_AMOUNTS = ["25%", "50%", "75%", "Max"];

export interface ErrorDetails {
  message: string;
  details: string;
}

type BankWithdrawFlow = Pick<
  FlowState,
  | "balance"
  | "decimals"
  | "formattedBalance"
  | "plusdAuthorized"
  | "refetchBalance"
  | "networkFee"
  | "isConnected"
>;

interface BankWithdrawTabProps {
  flow: BankWithdrawFlow;
  tabs: ReactNode;
  onSwap?: () => void;
  connectBanner: ReactNode;
  onShowErrorDetails: (details: ErrorDetails) => void;
}

const headingClasses =
  "m-0 font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-body)] leading-[var(--text-pipeline-body--line-height)] font-[var(--font-weight-emphasized)] text-[color:var(--color-pipeline-ink)]";

export function BankWithdrawTab({
  flow,
  tabs,
  onSwap,
  connectBanner,
  onShowErrorDetails,
}: BankWithdrawTabProps) {
  const { kind } = useWalletView();
  const toast = useToast();
  const kybPassed = useKybPassed();
  const [amountInput, setAmountInput] = useState("");
  const [submittedIds, setSubmittedIds] = useState<string[]>([]);
  const { rows, refetch } = useWireOutList(submittedIds);
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
      if (lastWireOutId !== undefined)
        setSubmittedIds((prev) => [lastWireOutId, ...prev]);
      refetch();
      refetchBalance();
      setAmountInput("");
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
    refetch,
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

  const inputDisabled =
    !flow.isConnected || isPending || flow.balance === undefined;

  return (
    <>
      <ConversionCard
        data-testid="bank-conversion-card"
        header={tabs}
        input={{
          token: "plusd",
          tokenLabel: "PLUSD",
          inputTestId: "wire-out-amount-input",
          balanceLabel: flow.formattedBalance
            ? flow.formattedBalance.replace(/^\$/, "")
            : "—",
          placeholderValue: "0",
          value: amountInput,
          onValueChange: setAmountInput,
          disabled: inputDisabled,
          quickAmounts: QUICK_AMOUNTS.map((label) => ({
            label,
            disabled: inputDisabled,
          })),
          onQuickAmountClick: onQuickAmount,
        }}
        output={{
          token: "usdc",
          tokenLabel: "USD to your bank account",
          balanceLabel: "Bank wire",
          value: amountInput || "0",
        }}
        exchangeRate="1 PLUSD = 1 USD"
        networkFee={flow.networkFee ?? "—"}
        onSwap={isPending ? undefined : onSwap}
      />

      {wireOut.exceedsBalance && (
        <InlineError
          message={WIRE_OUT_ABOVE_BALANCE_REASON}
          className="self-end"
        />
      )}

      {!flow.isConnected ? (
        connectBanner
      ) : (
        <>
          <Card
            variant="plain"
            padding="none"
            data-testid="wire-out-info-block"
            className="px-4 py-4"
          >
            <WireOutInfoCard />
          </Card>
          <StepsCard data-testid="wire-out-steps-card" steps={wireOut.steps} />
        </>
      )}

      {rows.length > 0 && (
        <Card
          variant="plain"
          padding="none"
          data-testid="wire-out-list"
          className="flex flex-col gap-3 px-4 py-4"
        >
          <h2 className={headingClasses}>Your bank wire-outs</h2>
          {rows.map((row) => (
            <div key={row.id} data-testid={`wire-out-row-${row.id}`}>
              {renderWireOutRow({
                timestamp: row.timestamp,
                read: row.read,
                decimals: flow.decimals,
              })}
            </div>
          ))}
        </Card>
      )}
    </>
  );
}
