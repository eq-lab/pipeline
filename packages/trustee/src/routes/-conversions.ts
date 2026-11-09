// spec: docs/frontend/trustee-flows.md#cash-management--conversions-and-bank-charges
import { useEffect, useMemo, useRef, useState } from "react";
import {
  parseUsdDollarsToI128,
  readWireInRefHashSeen,
  useStellarWallet,
  wireInReturnRefHash,
  type MinterRamp,
  type RampDirection,
} from "@pipeline/wallet-connect";
import { useSessionState } from "@/auth/sessionStore";
import { useCashBook, type CashBookRamp } from "@/api/useCashBook";
import {
  fetchMinterPaused,
  fetchMinterRamp,
  useCloseRamp,
  useConversionAccess,
  useMinterPaused,
  useMinterPoolState,
  useMinterRamps,
  useOpenRamp,
  useRecordExpense,
  type ConversionFn,
} from "@/api/useConversions";
import { ENV } from "@/lib/env";
import { targetChainLabel } from "@/lib/targetChains";
import { cashBookError } from "@/lib/wireEscrow";
import {
  RAMP_DIRECTION_LABEL,
  closeFormError,
  conversionAccessReason,
  conversionErrorCopy,
  expenseFormError,
  openFormError,
  parseReceivedRaw,
  rampRowState,
  rampStateLabel,
  rampStateReason,
  type RampChainState,
} from "@/lib/conversions";
import {
  REUSED_BANK_REFERENCE_COPY,
  rawToDecimal7,
  todayUtcDateInput,
  valueDateSeconds,
} from "@/lib/wireOut";
import { chainKindOf } from "./-settlementAddresses";
import { formatIsoDateTimeUtc } from "@/utils/formatDate";
import { formatUsdExact } from "@/utils/formatUsd";
import type { UserFacingError } from "@/utils/userError";

export const CONVERSION_REFETCH_MS = 30_000;
export const CONVERSION_PENDING_REFETCH_MS = 5_000;
export const CONVERSION_PENDING_WINDOW_MS = 120_000;

export const NOT_CONFIGURED_COPY =
  "Conversion and bank-charge actions are not configured for this environment.";
export const MINTER_MISMATCH_COPY =
  "The app's minter differs from the server's cash-book minter.";
export const PAUSED_COPY =
  "The minter is paused; conversions cannot be opened.";

export type ConversionSectionState =
  | "unsupported"
  | "loading"
  | "error"
  | "empty"
  | "ready";

export type PoolSummaryState = "unsupported" | "loading" | "error" | "ready";

export interface ConversionRow {
  id: number;
  status: CashBookRamp["status"];
  direction: RampDirection;
  directionLabel: string;
  amount: string;
  amountRaw: string;
  openedAt: string;
  openRefHash: string;
  received: string;
  shortfall: string;
  closedAt: string;
  closeRefHash: string | null;
  chainState: RampChainState | null;
  chainLabel: string;
}

export interface OpenDialogState {
  direction: RampDirection | null;
  amountInput: string;
  reference: string;
  refHash: string | null;
  error: UserFacingError | null;
  submitting: boolean;
}

export type ClosePhase = "reading" | "open" | "closed" | "read-error";

export interface CloseDialogState {
  row: ConversionRow;
  phase: ClosePhase;
  ramp: MinterRamp | null;
  receivedInput: string;
  reference: string;
  refHash: string | null;
  error: UserFacingError | null;
  submitting: boolean;
}

export interface ExpenseDialogState {
  amountInput: string;
  valueDateInput: string;
  reference: string;
  refHash: string | null;
  error: UserFacingError | null;
  submitting: boolean;
}

export type ConversionResult =
  | { kind: "opened"; hash: string; direction: RampDirection; amount: string }
  | { kind: "closed"; id: number; hash: string; received: string }
  | { kind: "close-unverified"; id: number; hash: string }
  | { kind: "expense"; hash: string; amount: string; valueDate: string };

export function conversionResultMessage(result: ConversionResult): string {
  switch (result.kind) {
    case "opened":
      return `Conversion opened on-chain (${RAMP_DIRECTION_LABEL[result.direction]}, ${result.amount}). Transaction ${result.hash}. It appears in the list once indexed.`;
    case "closed":
      return `Conversion #${result.id} closed on-chain. Received ${result.received}; any shortfall is booked as an expense and shows in this list once indexed. Transaction ${result.hash}.`;
    case "close-unverified":
      return `Conversion #${result.id} closed on-chain, but the result could not be re-read. Refresh the list. Transaction ${result.hash}.`;
    case "expense":
      return `Bank charge of ${result.amount} booked on-chain, value date ${result.valueDate}; it was burned from the vault. Transaction ${result.hash}. It appears in the Audit Log once indexed.`;
  }
}

export function openValidation(state: OpenDialogState): string | null {
  return openFormError(state);
}

export function closeValidation(state: CloseDialogState): string | null {
  if (!state.ramp) return "Confirming this conversion on-chain…";
  return closeFormError({
    receivedInput: state.receivedInput,
    amountRaw: state.ramp.amount,
    reference: state.reference,
  });
}

export function expenseValidation(state: ExpenseDialogState): string | null {
  return expenseFormError({ ...state, today: todayUtcDateInput() });
}

function servedOrDash(value: string | undefined): string {
  return value === undefined ? "—" : formatUsdExact(value);
}

function failure(message: string, details: string): UserFacingError {
  return { message, details, isSpecific: true };
}

function rpcOptions() {
  return {
    rpcUrl: ENV.STELLAR_RPC_URL,
    networkPassphrase: ENV.STELLAR_NETWORK_PASSPHRASE,
  };
}

export function useConversionsSection() {
  const chainId = useSessionState().chainId ?? ENV.STELLAR_CHAIN_ID;
  const kind = chainKindOf(chainId);
  const chainLabel = targetChainLabel(chainId);
  const stellar = kind === "stellar";
  const wallet = useStellarWallet();
  const openMutation = useOpenRamp();
  const closeMutation = useCloseRamp();
  const expenseMutation = useRecordExpense();
  const [openDialog, setOpenDialog] = useState<OpenDialogState | null>(null);
  const [closeDialog, setCloseDialog] = useState<CloseDialogState | null>(null);
  const [expenseDialog, setExpenseDialog] = useState<ExpenseDialogState | null>(
    null,
  );
  const [lastResult, setLastResult] = useState<ConversionResult | null>(null);
  const [fastPoll, setFastPoll] = useState(false);
  const windowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const token = useRef(0);

  function startPendingWindow() {
    if (windowTimer.current) clearTimeout(windowTimer.current);
    setFastPoll(true);
    windowTimer.current = setTimeout(
      () => setFastPoll(false),
      CONVERSION_PENDING_WINDOW_MS,
    );
  }
  useEffect(
    () => () => {
      if (windowTimer.current) clearTimeout(windowTimer.current);
    },
    [],
  );

  const minterConfigured = !!ENV.STELLAR_YIELD_MINTER_ID;
  const configured =
    minterConfigured && !!ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID;
  const poolState = useMinterPoolState(stellar);
  const paused = useMinterPaused(stellar);
  const cashBook = useCashBook(chainId, {
    enabled: stellar,
    refetchMs: fastPoll ? CONVERSION_PENDING_REFETCH_MS : CONVERSION_REFETCH_MS,
  });
  const served = useMemo(() => cashBook.data?.ramps ?? [], [cashBook.data]);
  const openServed = served.filter((r) => r.status === "Open");
  const reads = useMinterRamps(
    openServed.map((r) => r.id),
    stellar,
  );

  const connected = wallet.isConnected && !!wallet.address;
  const accessEnabled = stellar && connected;
  const access: Record<ConversionFn, ReturnType<typeof useConversionAccess>> = {
    open_ramp: useConversionAccess("open_ramp", accessEnabled),
    close_ramp: useConversionAccess("close_ramp", accessEnabled),
    record_expense: useConversionAccess("record_expense", accessEnabled),
  };

  const rows: ConversionRow[] = served.map((ramp: CashBookRamp) => {
    const readIndex = openServed.findIndex((r) => r.id === ramp.id);
    const read = readIndex === -1 ? undefined : reads[readIndex];
    const chainState =
      readIndex === -1
        ? null
        : rampRowState(ramp.status, {
            data: read?.data,
            isPending: read?.isPending ?? true,
            isError: read?.isError ?? false,
          });
    return {
      id: ramp.id,
      status: ramp.status,
      direction: ramp.direction,
      directionLabel: RAMP_DIRECTION_LABEL[ramp.direction],
      amount: formatUsdExact(ramp.amount),
      amountRaw: ramp.amount,
      openedAt: formatIsoDateTimeUtc(ramp.opened_at),
      openRefHash: ramp.open_ref_hash,
      received: servedOrDash(ramp.received),
      shortfall: servedOrDash(ramp.loss),
      closedAt: formatIsoDateTimeUtc(ramp.closed_at),
      closeRefHash: ramp.close_ref_hash ?? null,
      chainState,
      chainLabel: chainState === null ? "—" : rampStateLabel(chainState),
    };
  });

  const minterMismatch =
    !!cashBook.data &&
    minterConfigured &&
    cashBook.data.minter !== ENV.STELLAR_YIELD_MINTER_ID;
  const busy =
    !!openDialog?.submitting ||
    !!closeDialog?.submitting ||
    !!expenseDialog?.submitting;

  function minterCheckReason(): string | null {
    if (cashBook.data) return minterMismatch ? MINTER_MISMATCH_COPY : null;
    if (cashBook.isError)
      return "Could not verify the server's cash-book minter.";
    return "Checking the server's cash-book minter…";
  }

  function actionReason(fn: ConversionFn, row?: ConversionRow): string | null {
    if (!connected) {
      return "Connect your trustee wallet to book conversions and bank charges.";
    }
    if (!configured) return NOT_CONFIGURED_COPY;
    const check = minterCheckReason();
    if (check) return check;
    const q = access[fn];
    const role = conversionAccessReason(fn, {
      access: q.data,
      isPending: q.isPending,
      isError: q.isError,
    });
    if (role) return role;
    if (fn === "open_ramp") {
      if (paused.isPending) return "Checking whether the minter is paused…";
      if (paused.isError)
        return "Could not check whether the minter is paused.";
      if (paused.data) return PAUSED_COPY;
    }
    if (
      fn === "close_ramp" &&
      row?.chainState &&
      row.chainState !== "confirmed"
    ) {
      return rampStateReason(row.chainState);
    }
    if (busy) return "Another action is in flight. Wait for it to finish.";
    return null;
  }

  function hashReference<S extends { refHash: string | null }>(
    reference: string,
    patch: (next: Partial<S>) => void,
  ) {
    patch({ refHash: null } as Partial<S>);
    if (reference.trim() === "") return;
    const mine = ++token.current;
    void wireInReturnRefHash(reference).then((refHash) => {
      if (mine !== token.current) return;
      patch({ refHash } as Partial<S>);
    });
  }

  async function referenceSeen(
    refHash: string,
  ): Promise<UserFacingError | null> {
    const seen = await readWireInRefHashSeen({
      minterId: ENV.STELLAR_YIELD_MINTER_ID,
      refHash,
      ...rpcOptions(),
    });
    return seen
      ? failure(REUSED_BANK_REFERENCE_COPY, `ref_hash_seen(${refHash}) is true`)
      : null;
  }

  // ── Open ──────────────────────────────────────────────────────────────────

  function patchOpen(next: Partial<OpenDialogState>) {
    setOpenDialog((prev) => (prev ? { ...prev, ...next } : prev));
  }

  function openOpen() {
    if (actionReason("open_ramp") !== null) return;
    openMutation.reset();
    token.current += 1;
    setOpenDialog({
      direction: null,
      amountInput: "",
      reference: "",
      refHash: null,
      error: null,
      submitting: false,
    });
  }

  function closeOpen() {
    if (openDialog?.submitting) return;
    token.current += 1;
    setOpenDialog(null);
    openMutation.reset();
  }

  function setOpenDirection(direction: RampDirection) {
    patchOpen({ direction, error: null });
  }

  function setOpenAmount(amountInput: string) {
    patchOpen({ amountInput, error: null });
  }

  function setOpenReference(reference: string) {
    patchOpen({ reference, error: null });
    hashReference<OpenDialogState>(reference, patchOpen);
  }

  async function confirmOpen() {
    if (!openDialog || busy) return;
    if (openValidation(openDialog) !== null) return;
    const { direction, amountInput, reference } = openDialog;
    if (direction === null) return;
    const mine = token.current;
    patchOpen({ submitting: true, error: null });
    try {
      const refHash = await wireInReturnRefHash(reference);
      const reused = await referenceSeen(refHash);
      if (mine !== token.current) return;
      if (reused) {
        patchOpen({ submitting: false, refHash, error: reused });
        return;
      }
      if (await fetchMinterPaused()) {
        if (mine !== token.current) return;
        patchOpen({
          submitting: false,
          error: failure(PAUSED_COPY, "paused() is true"),
        });
        return;
      }
      if (mine !== token.current) return;
      let hash: string;
      try {
        ({ hash } = await openMutation.mutateAsync({
          direction,
          amountRaw: parseUsdDollarsToI128(amountInput).toString(),
          refHash,
        }));
      } catch (error) {
        patchOpen({
          submitting: false,
          error: conversionErrorCopy("open_ramp", error),
        });
        return;
      }
      void poolState.refetch();
      startPendingWindow();
      setLastResult({
        kind: "opened",
        hash,
        direction,
        amount: amountInput.trim(),
      });
      token.current += 1;
      setOpenDialog(null);
    } catch (error) {
      if (mine !== token.current) return;
      patchOpen({
        submitting: false,
        error: conversionErrorCopy("open_ramp", error),
      });
    }
  }

  // ── Close ─────────────────────────────────────────────────────────────────

  function patchClose(next: Partial<CloseDialogState>) {
    setCloseDialog((prev) => (prev ? { ...prev, ...next } : prev));
  }

  async function openClose(row: ConversionRow) {
    if (row.status !== "Open" || actionReason("close_ramp", row) !== null) {
      return;
    }
    closeMutation.reset();
    const mine = ++token.current;
    const base = {
      row,
      ramp: null,
      receivedInput: "",
      reference: "",
      refHash: null,
      error: null,
      submitting: false,
    };
    setCloseDialog({ ...base, phase: "reading" });
    try {
      const ramp = await fetchMinterRamp(row.id);
      if (mine !== token.current) return;
      setCloseDialog({ ...base, ramp, phase: ramp.closed ? "closed" : "open" });
    } catch (error) {
      if (mine !== token.current) return;
      setCloseDialog({
        ...base,
        phase: "read-error",
        error: failure(
          "Could not read this conversion on-chain.",
          error instanceof Error ? error.message : String(error),
        ),
      });
    }
  }

  function closeClose() {
    if (closeDialog?.submitting) return;
    token.current += 1;
    setCloseDialog(null);
    closeMutation.reset();
  }

  function setReceivedInput(receivedInput: string) {
    patchClose({ receivedInput, error: null });
  }

  function setCloseReference(reference: string) {
    patchClose({ reference, error: null });
    hashReference<CloseDialogState>(reference, patchClose);
  }

  async function confirmClose() {
    if (!closeDialog || closeDialog.phase !== "open" || busy) return;
    if (closeValidation(closeDialog) !== null) return;
    const { row, receivedInput, reference } = closeDialog;
    const received = parseReceivedRaw(receivedInput);
    if (received === null) return;
    const mine = token.current;
    patchClose({ submitting: true, error: null });
    try {
      const refHash = await wireInReturnRefHash(reference);
      const reused = await referenceSeen(refHash);
      if (mine !== token.current) return;
      if (reused) {
        patchClose({ submitting: false, refHash, error: reused });
        return;
      }
      const chain = await fetchMinterRamp(row.id);
      if (mine !== token.current) return;
      if (chain.closed) {
        patchClose({
          submitting: false,
          phase: "closed",
          ramp: chain,
          error: failure(
            "This conversion is already closed. Refresh the list.",
            `ramp(${chain.id}).closed is true`,
          ),
        });
        return;
      }
      const mismatch = closeFormError({
        receivedInput,
        amountRaw: chain.amount,
        reference,
      });
      if (mismatch !== null) {
        patchClose({
          submitting: false,
          ramp: chain,
          error: failure(
            mismatch,
            `ramp(${chain.id}).amount is ${chain.amount}`,
          ),
        });
        return;
      }
      let hash: string;
      try {
        ({ hash } = await closeMutation.mutateAsync({
          id: row.id,
          receivedRaw: received.toString(),
          refHash,
        }));
      } catch (error) {
        patchClose({
          submitting: false,
          error: conversionErrorCopy("close_ramp", error),
        });
        return;
      }
      startPendingWindow();
      setLastResult(await afterClose(row.id, hash));
      token.current += 1;
      setCloseDialog(null);
    } catch (error) {
      if (mine !== token.current) return;
      patchClose({
        submitting: false,
        error: conversionErrorCopy("close_ramp", error),
      });
    }
  }

  async function afterClose(
    id: number,
    hash: string,
  ): Promise<ConversionResult> {
    try {
      const chain = await fetchMinterRamp(id);
      return {
        kind: "closed",
        id,
        hash,
        received: rawToDecimal7(chain.received),
      };
    } catch {
      return { kind: "close-unverified", id, hash };
    }
  }

  // ── Expense ───────────────────────────────────────────────────────────────

  function patchExpense(next: Partial<ExpenseDialogState>) {
    setExpenseDialog((prev) => (prev ? { ...prev, ...next } : prev));
  }

  function openExpense() {
    if (actionReason("record_expense") !== null) return;
    expenseMutation.reset();
    token.current += 1;
    setExpenseDialog({
      amountInput: "",
      valueDateInput: todayUtcDateInput(),
      reference: "",
      refHash: null,
      error: null,
      submitting: false,
    });
  }

  function closeExpense() {
    if (expenseDialog?.submitting) return;
    token.current += 1;
    setExpenseDialog(null);
    expenseMutation.reset();
  }

  function setExpenseAmount(amountInput: string) {
    patchExpense({ amountInput, error: null });
  }

  function setExpenseDate(valueDateInput: string) {
    patchExpense({ valueDateInput, error: null });
  }

  function setExpenseReference(reference: string) {
    patchExpense({ reference, error: null });
    hashReference<ExpenseDialogState>(reference, patchExpense);
  }

  async function confirmExpense() {
    if (!expenseDialog || busy) return;
    if (expenseValidation(expenseDialog) !== null) return;
    const { amountInput, valueDateInput, reference } = expenseDialog;
    const mine = token.current;
    patchExpense({ submitting: true, error: null });
    try {
      const refHash = await wireInReturnRefHash(reference);
      const reused = await referenceSeen(refHash);
      if (mine !== token.current) return;
      if (reused) {
        patchExpense({ submitting: false, refHash, error: reused });
        return;
      }
      let hash: string;
      try {
        ({ hash } = await expenseMutation.mutateAsync({
          deltaRaw: parseUsdDollarsToI128(amountInput).toString(),
          valueDate: valueDateSeconds(valueDateInput),
          refHash,
        }));
      } catch (error) {
        patchExpense({
          submitting: false,
          error: conversionErrorCopy("record_expense", error),
        });
        return;
      }
      void poolState.refetch();
      setLastResult({
        kind: "expense",
        hash,
        amount: amountInput.trim(),
        valueDate: valueDateInput,
      });
      token.current += 1;
      setExpenseDialog(null);
    } catch (error) {
      if (mine !== token.current) return;
      patchExpense({
        submitting: false,
        error: conversionErrorCopy("record_expense", error),
      });
    }
  }

  // ── View model ────────────────────────────────────────────────────────────

  const listError = cashBook.error
    ? cashBookError(cashBook.error, chainLabel)
    : null;
  const state: ConversionSectionState = !stellar
    ? "unsupported"
    : cashBook.isPending
      ? "loading"
      : cashBook.isError && !cashBook.data
        ? "error"
        : rows.length === 0
          ? "empty"
          : "ready";

  const summaryError: UserFacingError | null = !minterConfigured
    ? failure(NOT_CONFIGURED_COPY, "VITE_STELLAR_YIELD_MINTER_ID is empty")
    : poolState.isError
      ? failure(
          "Could not read the minter's pool state.",
          poolState.error.message,
        )
      : null;
  const summaryState: PoolSummaryState = !stellar
    ? "unsupported"
    : summaryError
      ? "error"
      : poolState.data
        ? "ready"
        : "loading";
  const pool = poolState.data;
  const sourceMinter = ENV.STELLAR_YIELD_MINTER_ID
    ? `${ENV.STELLAR_YIELD_MINTER_ID.slice(0, 4)}…${ENV.STELLAR_YIELD_MINTER_ID.slice(-4)}`
    : "—";
  const dollars = (raw: string | undefined) =>
    raw === undefined ? "—" : formatUsdExact(rawToDecimal7(raw));

  return {
    chainLabel,
    kind,
    unsupportedReason: `Conversions and bank charges on ${chainLabel} are not available in the Trustee app yet.`,
    summary: {
      state: summaryState,
      error: summaryError,
      bankCash: dollars(pool?.bankCash),
      inFlight: dollars(pool?.inFlight),
      totalAssets: dollars(pool?.totalAssets),
      readFailed: pool?.readFailed ?? false,
      sourceMinter,
      retry: () => void poolState.refetch(),
    },
    state,
    emptyMessage: `No conversions on ${chainLabel}.`,
    error: state === "error" ? listError : null,
    refresh: () => void cashBook.refetch(),
    rows,
    actionReason,
    minterMismatch,
    lastResult,
    dismissResult: () => setLastResult(null),
    openDialog,
    openOpen,
    closeOpen,
    setOpenDirection,
    setOpenAmount,
    setOpenReference,
    confirmOpen,
    openStage: openMutation.stage,
    closeDialog,
    openClose,
    closeClose,
    setReceivedInput,
    setCloseReference,
    confirmClose,
    closeStage: closeMutation.stage,
    expenseDialog,
    openExpense,
    closeExpense,
    setExpenseAmount,
    setExpenseDate,
    setExpenseReference,
    confirmExpense,
    expenseStage: expenseMutation.stage,
    busy,
  };
}

export type ConversionsSection = ReturnType<typeof useConversionsSection>;
