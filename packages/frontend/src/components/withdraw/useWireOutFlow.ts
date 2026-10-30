// spec: docs/product-specs/withdrawals.md#bank-wire-withdrawals-lp-app
import { useCallback } from "react";
import type { StepItem } from "@pipeline/ui";
import {
  isWireOutMinterConfigured,
  useApproval,
  useDepositManagerAddresses,
  useEvmRequestWireOut,
  useMinterPaused,
  useStellarRequestWireOut,
} from "@/wallet";
import type { WalletViewKind } from "@/wallet";
import { ENV } from "@/lib/env";
import { parseUsdc } from "@/lib/usdc";
import { toUserError } from "@/utils/userError";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const WIRE_OUT_KYB_REASON = "Complete KYB to withdraw to a bank account";
export const WIRE_OUT_PAUSED_REASON =
  "Bank wire-outs are paused. Check the status page before retrying.";
export const WIRE_OUT_NOT_AUTHORISED_REASON =
  "Your address must be authorised to hold PLUSD to request a bank wire-out.";
export const WIRE_OUT_UNAVAILABLE_REASON =
  "Bank wire-outs are not available on this network.";
export const WIRE_OUT_ZERO_AMOUNT_REASON = "Enter an amount greater than zero.";
export const WIRE_OUT_ABOVE_BALANCE_REASON = "Insufficient balance";
export const WIRE_OUT_REQUEST_HINT =
  "The PLUSD moves into escrow until the Trustee settles or cancels the request.";

export interface WireOutGateInput {
  kind: WalletViewKind;
  plusdAuthorized: boolean | undefined;
  kybPassed: boolean;
}

export function useWireOutGate({
  kind,
  plusdAuthorized,
  kybPassed,
}: WireOutGateInput): { blockedReason: string | undefined } {
  const paused = useMinterPaused(kind);
  let blockedReason: string | undefined;
  if (!isWireOutMinterConfigured(kind))
    blockedReason = WIRE_OUT_UNAVAILABLE_REASON;
  else if (!kybPassed) blockedReason = WIRE_OUT_KYB_REASON;
  else if (paused === true) blockedReason = WIRE_OUT_PAUSED_REASON;
  else if (plusdAuthorized === false)
    blockedReason = WIRE_OUT_NOT_AUTHORISED_REASON;
  return { blockedReason };
}

export interface UseWireOutFlowInput extends WireOutGateInput {
  amountInput: string;
  balance: bigint | undefined;
  decimals: number | undefined;
}

export interface UseWireOutFlowResult {
  steps: StepItem[];
  amountRaw: bigint;
  exceedsBalance: boolean;
  disabledReason: string | undefined;
  blockedReason: string | undefined;
  isPending: boolean;
  isSuccess: boolean;
  lastWireOutId: string | undefined;
  submit: () => void;
  reset: () => void;
}

function stepError(error: Error | null) {
  if (!error) return {};
  const mapped = toUserError(error, { context: "wireOut" });
  return {
    state: "error" as const,
    errorMessage: mapped.message,
    errorDetails: mapped.details,
  };
}

export function useWireOutFlow(
  input: UseWireOutFlowInput,
): UseWireOutFlowResult {
  const { kind, amountInput, balance, decimals } = input;
  const isStellar = kind === "stellar";

  const amountRaw = parseUsdc(amountInput, decimals);
  const exceedsBalance = balance !== undefined && amountRaw > balance;
  const { blockedReason } = useWireOutGate(input);

  const stellar = useStellarRequestWireOut();
  const evm = useEvmRequestWireOut();
  const write = isStellar ? stellar : evm;

  const { plusd } = useDepositManagerAddresses();
  const approval = useApproval({
    token: (plusd ?? ZERO_ADDRESS) as `0x${string}`,
    spender: ENV.EVM_MINTER_ADDRESS,
  });

  let disabledReason = blockedReason;
  if (disabledReason === undefined) {
    if (amountRaw === 0n) disabledReason = WIRE_OUT_ZERO_AMOUNT_REASON;
    else if (balance === undefined || exceedsBalance)
      disabledReason = WIRE_OUT_ABOVE_BALANCE_REASON;
  }

  const submit = useCallback(() => {
    write.request(amountRaw);
  }, [write, amountRaw]);

  const { reset: resetStellar } = stellar;
  const { reset: resetEvm } = evm;
  const { reset: resetApproval } = approval;
  const reset = useCallback(() => {
    resetStellar();
    resetEvm();
    resetApproval();
  }, [resetStellar, resetEvm, resetApproval]);

  const approved = amountRaw > 0n && approval.isSufficient(amountRaw);

  const requestStep: StepItem = {
    label: "Request wire-out",
    actionLabel: "Request",
    hint: WIRE_OUT_REQUEST_HINT,
    state: write.isSuccess ? "success" : "idle",
    loading: write.isPending,
    disabled:
      disabledReason !== undefined ||
      write.isPending ||
      write.isSuccess ||
      (!isStellar && !approved),
    onAction: submit,
    ...stepError(write.error),
  };

  const steps: StepItem[] = isStellar
    ? [requestStep]
    : [
        {
          label: "Allow Pipeline to use PLUSD",
          actionLabel: "Approve",
          state: approved ? "success" : "idle",
          loading: approval.isPending,
          disabled:
            disabledReason !== undefined || approval.isPending || approved,
          onAction: () => approval.approve(amountRaw),
          ...(approved ? {} : stepError(approval.error)),
        },
        requestStep,
      ];

  return {
    steps,
    amountRaw,
    exceedsBalance,
    disabledReason,
    blockedReason,
    isPending: write.isPending,
    isSuccess: write.isSuccess,
    lastWireOutId: write.wireOutId,
    submit,
    reset,
  };
}
