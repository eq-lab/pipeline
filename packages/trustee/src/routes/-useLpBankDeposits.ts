// spec: docs/frontend/trustee-flows.md#lp-bank-deposits
import { useRef, useState } from "react";
import {
  useLpBankDeposits,
  useRecordBankDeposit,
  type LpBankDeposit,
} from "@/api/useLpBankDeposits";
import { ApiError } from "@/api/client";

const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;
const MAX_AMOUNT = 1_000_000_000_000_000;

/** Current UTC time as a `datetime-local` value (`YYYY-MM-DDTHH:MM`). */
export function nowUtcInput(now = new Date()): string {
  return now.toISOString().slice(0, 16);
}

/** `datetime-local` value, read as UTC → ISO-8601 with a `Z` offset. */
export function utcInputToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const iso = `${value}:00Z`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** Strips grouping commas/spaces; `null` unless a positive ≤2dp decimal. */
export function normalizeAmount(raw: string): string | null {
  const value = raw.replace(/[,\s]/g, "");
  if (!AMOUNT_PATTERN.test(value)) return null;
  const n = Number(value);
  return n > 0 && n <= MAX_AMOUNT ? value : null;
}

/** `"50000.5"` → `"$50,000.50"`, string-based so large amounts stay exact. */
export function formatDepositAmount(amount: string): string {
  const [whole = "0", fraction = ""] = amount.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `$${grouped}.${fraction.padEnd(2, "0").slice(0, 2)}`;
}

/** `2026-10-05T15:41:00Z` → `05 Oct 2026, 15:41 UTC`. */
export function formatDepositTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const day = date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${day}, ${iso.slice(11, 16)} UTC`;
}

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
    occurredAt: formatDepositTime(deposit.occurred_at),
    amount: formatDepositAmount(deposit.amount),
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
  const [occurredAt, setOccurredAt] = useState(nowUtcInput);
  const [touched, setTouched] = useState(false);
  const submitting = useRef(false);

  const normalizedAmount = normalizeAmount(amount);
  const occurredIso = utcInputToIso(occurredAt);
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
    setOccurredAt(nowUtcInput());
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
