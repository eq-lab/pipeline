// spec: docs/frontend/trustee-flows.md#lp-bank-deposits
import { useRef, useState } from "react";
import {
  useLpBankDeposits,
  useRecordBankDeposit,
  type LpBankDeposit,
} from "@/api/useLpBankDeposits";
import { ApiError } from "@/api/client";
import {
  formatIsoDateTimeUtc,
  nowUtcDateTimeInput,
  utcDateTimeInputToIso,
} from "@/utils/formatDate";
import { formatUsdDecimal, parseUsdCentsInput } from "@/utils/formatUsd";

export function depositError(error: Error | null) {
  if (!error) return null;
  const status = error instanceof ApiError ? error.status : undefined;
  const message =
    status === 401
      ? "Your session expired. Sign in again."
      : status === 403
        ? "Your trustee account is not authorized to record bank deposits."
        : status === 404
          ? "This LP was not found. Refresh the account details."
          : status === 409
            ? "A deposit with this payment reference is already recorded."
            : status === 400
              ? "Check the amount, payment reference, and date, then try again."
              : "Could not complete the request. Check your connection and try again.";
  return { message, details: error.message };
}

export interface DepositRow {
  id: number;
  occurredAt: string;
  amount: string;
  reference: string;
  refHash: string;
  minted: string;
  recordedBy: string;
}

export function mapDepositToRow(deposit: LpBankDeposit): DepositRow {
  return {
    id: deposit.id,
    occurredAt: formatIsoDateTimeUtc(deposit.occurred_at),
    amount: formatUsdDecimal(deposit.amount),
    reference: deposit.payment_reference,
    refHash: deposit.ref_hash,
    minted: deposit.is_minted ? "Minted" : "Not minted",
    recordedBy: deposit.recorded_by,
  };
}

export function useLpBankDepositsSection(lpId: number) {
  const query = useLpBankDeposits(lpId);
  const mutation = useRecordBankDeposit();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [occurredAt, setOccurredAt] = useState(nowUtcDateTimeInput);
  const [touched, setTouched] = useState(false);
  const submitting = useRef(false);

  const normalizedAmount = parseUsdCentsInput(amount);
  const occurredIso = utcDateTimeInputToIso(occurredAt);
  const validationError = !normalizedAmount
    ? "Enter an amount greater than 0 with at most 2 decimal places."
    : !reference.trim()
      ? "Enter the bank's payment reference."
      : !occurredIso
        ? "Enter when the wire was received."
        : Date.parse(occurredIso) > Date.now()
          ? "The receipt time cannot be in the future."
          : null;

  function openDialog() {
    if (submitting.current) return;
    mutation.reset();
    setAmount("");
    setReference("");
    setOccurredAt(nowUtcDateTimeInput());
    setTouched(false);
    setOpen(true);
  }
  function close() {
    if (submitting.current) return;
    setOpen(false);
    mutation.reset();
  }
  async function submit() {
    setTouched(true);
    if (validationError || submitting.current) return;
    submitting.current = true;
    try {
      await mutation.mutateAsync({
        lpId,
        amount: normalizedAmount!,
        payment_reference: reference.trim(),
        occurred_at: occurredIso!,
      });
      setOpen(false);
    } catch {
      return;
    } finally {
      submitting.current = false;
    }
  }

  const deposits = query.data?.deposits ?? [];
  return {
    query,
    rows: deposits.map(mapDepositToRow),
    state: query.isPending
      ? ("loading" as const)
      : query.isError && !query.data
        ? ("error" as const)
        : deposits.length === 0
          ? ("empty" as const)
          : ("ready" as const),
    error: depositError(query.error),
    refresh: () => void query.refetch(),
    open,
    openDialog,
    close,
    submit,
    amount,
    setAmount,
    reference,
    setReference,
    occurredAt,
    setOccurredAt,
    validationError: touched ? validationError : null,
    busy: mutation.isPending,
    mutationError: depositError(mutation.error),
  };
}

export type LpBankDepositsSection = ReturnType<typeof useLpBankDepositsSection>;
