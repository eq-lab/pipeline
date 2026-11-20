// spec: docs/frontend/trustee-flows.md#cash-reporter-bookings
import { useState } from "react";
import { useStellarWallet } from "@pipeline/wallet-connect";
import { useCashReporterAccess } from "@/api/useCashReporterAccess";
import { useRecordIncome, type RecordIncomeStage } from "@/api/useRecordIncome";
import { ENV } from "@/lib/env";
import { useSessionState } from "@/auth/sessionStore";
import { targetChainLabel } from "@/lib/targetChains";
import { chainKindOf } from "./-settlementAddresses";
import { dateInputToValueDate, todayDateInput } from "@/utils/formatDate";
import { parseUsdCentsInput } from "@/utils/formatUsd";
import { toUserError, type UserFacingError } from "@/utils/userError";

export function incomeError(error: Error | null): UserFacingError | null {
  if (!error) return null;
  const mapped = toUserError(
    error,
    "Could not book this income. Please try again.",
  );
  if (/RefHashSeen/i.test(mapped.details)) {
    return {
      message:
        "This bank reference is already booked on-chain. Each bank record's reference can be used once.",
      details: mapped.details,
      isSpecific: true,
    };
  }
  return mapped;
}

export function incomeStageLabel(stage: RecordIncomeStage | null): string {
  switch (stage) {
    case "awaiting-signature":
      return "Awaiting signature…";
    case "submitting":
      return "Submitting…";
    case "confirming":
      return "Confirming…";
    default:
      return "Book income";
  }
}

export function incomeValidationError(input: {
  amount: string;
  valueDateInput: string;
  reference: string;
  today: string;
}): string | null {
  if (!parseUsdCentsInput(input.amount)) {
    return "Enter an amount greater than 0 with at most 2 decimal places.";
  }
  if (!input.reference.trim()) {
    return "Enter the bank's reference for this income.";
  }
  if (!input.valueDateInput) return "Enter the value date.";
  if (input.valueDateInput > input.today) {
    return "The value date cannot be in the future.";
  }
  return null;
}

export interface BookedIncome {
  hash: string;
  amount: string;
  valueDate: string;
}

export function useBankIncome() {
  const chainId = useSessionState().chainId ?? ENV.STELLAR_CHAIN_ID;
  const kind = chainKindOf(chainId);
  const chainLabel = targetChainLabel(chainId);
  const wallet = useStellarWallet();
  const role = useCashReporterAccess("record_income", kind === "stellar");
  const record = useRecordIncome();

  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [valueDateInput, setValueDateInput] = useState(todayDateInput());
  const [reference, setReference] = useState("");
  const [touched, setTouched] = useState(false);
  const [lastBooked, setLastBooked] = useState<BookedIncome | null>(null);

  const openReason =
    kind === "evm"
      ? `Booking bank income on ${chainLabel} is not available in the Trustee app yet.`
      : null;

  const submitReason =
    openReason ??
    (!wallet.isConnected || !wallet.address
      ? "Connect your trustee wallet to book bank income."
      : !ENV.STELLAR_YIELD_MINTER_ID
        ? "On-chain bank income booking is not configured for this environment."
        : role.reason);

  const today = todayDateInput();
  const validationError = incomeValidationError({
    amount,
    valueDateInput,
    reference,
    today,
  });

  function openDialog() {
    if (openReason !== null) return;
    record.reset();
    setAmount("");
    setReference("");
    setValueDateInput(todayDateInput());
    setTouched(false);
    setOpen(true);
  }

  function close() {
    if (record.isPending) return;
    setOpen(false);
  }

  async function submit() {
    setTouched(true);
    const normalized = parseUsdCentsInput(amount);
    if (validationError !== null || submitReason !== null || !normalized) {
      return;
    }
    try {
      const { hash } = await record.mutateAsync({
        amount: normalized,
        valueDate: dateInputToValueDate(valueDateInput),
        reference,
      });
      setLastBooked({ hash, amount: normalized, valueDate: valueDateInput });
      setOpen(false);
    } catch {
      return;
    }
  }

  return {
    kind,
    chainLabel,
    open,
    openDialog,
    close,
    amount,
    setAmount,
    valueDateInput,
    setValueDateInput,
    maxValueDate: today,
    reference,
    setReference,
    validationError: touched ? validationError : null,
    openReason,
    submitReason,
    busy: record.isPending,
    stage: record.stage,
    error: incomeError(record.error),
    lastBooked,
    submit,
  };
}

export type BankIncomeView = ReturnType<typeof useBankIncome>;
