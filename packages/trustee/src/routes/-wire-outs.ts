// spec: docs/frontend/trustee-flows.md#cash-management--bank-wire-outs
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  readPlusdAuthorization,
  readWireInRefHashSeen,
  useStellarWallet,
  wireInReturnRefHash,
  type PlusdAuthorization,
  type WireOutRecord,
} from "@pipeline/wallet-connect";
import { useSessionState } from "@/auth/sessionStore";
import { useCashBook, type CashBookWireOut } from "@/api/useCashBook";
import { ensureMinterPlusdId, useMinterPlusdId } from "@/api/useEscrowedWires";
import {
  fetchWireOutRecord,
  useCancelWireOut,
  useSettleWireOut,
  useWireOutAccess,
  useWireOutRecords,
  type WireOutFn,
} from "@/api/useWireOuts";
import { ENV } from "@/lib/env";
import { targetChainLabel } from "@/lib/targetChains";
import { cashBookError } from "@/lib/wireEscrow";
import {
  NOT_PENDING_COPY,
  REUSED_BANK_REFERENCE_COPY,
  rawToDecimal7,
  settleFormError,
  todayUtcDateInput,
  valueDateSeconds,
  wireOutAccessReason,
  wireOutErrorCopy,
  wireOutRowState,
  wireOutStateLabel,
  wireOutStateReason,
  type WireOutChainState,
} from "@/lib/wireOut";
import { chainKindOf } from "./-settlementAddresses";
import { formatIsoDateTimeUtc, formatIsoDateUtc } from "@/utils/formatDate";
import { formatUsdExact } from "@/utils/formatUsd";
import type { UserFacingError } from "@/utils/userError";

export const WIRE_OUT_REFETCH_MS = 30_000;
export const WIRE_OUT_PENDING_REFETCH_MS = 5_000;
export const WIRE_OUT_PENDING_WINDOW_MS = 120_000;

export type WireOutSectionState =
  | "unsupported"
  | "loading"
  | "error"
  | "empty"
  | "ready";

export interface WireOutRow {
  id: number;
  status: CashBookWireOut["status"];
  lenderName: string;
  lpId: number | null;
  lp: string;
  amount: string;
  amountRaw: string;
  requestedAt: string;
  settledAt: string;
  valueDate: string;
  refHash: string | null;
  cancelledAt: string;
  chainState: WireOutChainState | null;
  chainLabel: string;
  record: WireOutRecord | null;
}

export interface SettleDialogState {
  row: WireOutRow;
  record: WireOutRecord;
  amountInput: string;
  valueDateInput: string;
  reference: string;
  refHash: string | null;
  error: UserFacingError | null;
  submitting: boolean;
}

export type CancelPhase =
  | "reading"
  | "authorized"
  | "not-authorized"
  | "no-trustline"
  | "read-error";

export interface CancelDialogState {
  row: WireOutRow;
  phase: CancelPhase;
  error: UserFacingError | null;
  submitting: boolean;
}

export type WireOutResult =
  | { kind: "settled"; id: number; hash: string; status: string }
  | { kind: "cancelled"; id: number; hash: string; status: string; lp: string }
  | {
      kind: "unverified";
      id: number;
      hash: string;
      action: "settled" | "cancelled";
    };

export function wireOutResultMessage(result: WireOutResult): string {
  const indexed = "It updates in this list once indexed.";
  if (result.kind === "settled") {
    return `Wire-out #${result.id} settled on-chain. Status ${result.status}; the escrowed PLUSD was burned. Transaction ${result.hash}. ${indexed}`;
  }
  if (result.kind === "cancelled") {
    return `Wire-out #${result.id} cancelled on-chain. Status ${result.status}; the PLUSD was returned to ${result.lp}. Transaction ${result.hash}. ${indexed}`;
  }
  return `Wire-out #${result.id} ${result.action} on-chain, but the result could not be re-read. Refresh the list. Transaction ${result.hash}.`;
}

export function plusdAmount(amount: string): string {
  return `${formatUsdExact(amount).slice(1)} PLUSD`;
}

export function settleValidation(state: SettleDialogState): string | null {
  return settleFormError({
    amountInput: state.amountInput,
    amountRaw: state.record.amount,
    valueDateInput: state.valueDateInput,
    today: todayUtcDateInput(),
    reference: state.reference,
  });
}

function readFailure(message: string, error: unknown): UserFacingError {
  return {
    message,
    details: error instanceof Error ? error.message : String(error),
    isSpecific: true,
  };
}

function notPending(chain: WireOutRecord): UserFacingError {
  return {
    message: NOT_PENDING_COPY,
    details: `wire_out(${chain.id}) status is ${chain.status}`,
    isSpecific: true,
  };
}

function rpcOptions() {
  return {
    rpcUrl: ENV.STELLAR_RPC_URL,
    networkPassphrase: ENV.STELLAR_NETWORK_PASSPHRASE,
  };
}

export function useWireOutsSection() {
  const chainId = useSessionState().chainId ?? ENV.STELLAR_CHAIN_ID;
  const kind = chainKindOf(chainId);
  const chainLabel = targetChainLabel(chainId);
  const stellar = kind === "stellar";
  const wallet = useStellarWallet();
  const queryClient = useQueryClient();
  const settleMutation = useSettleWireOut();
  const cancelMutation = useCancelWireOut();
  const [settle, setSettle] = useState<SettleDialogState | null>(null);
  const [cancel, setCancel] = useState<CancelDialogState | null>(null);
  const [lastResult, setLastResult] = useState<WireOutResult | null>(null);
  const [expired, setExpired] = useState<ReadonlySet<number>>(() => new Set());
  const [pendingIds, setPendingIds] = useState<number[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const token = useRef(0);

  const fastPoll = pendingIds.some((id) => !expired.has(id));
  const cashBook = useCashBook(chainId, {
    enabled: stellar,
    refetchMs: fastPoll ? WIRE_OUT_PENDING_REFETCH_MS : WIRE_OUT_REFETCH_MS,
  });
  const served = useMemo(() => cashBook.data?.wire_outs ?? [], [cashBook.data]);
  const pendingServed = served.filter((w) => w.status === "Pending");
  const reads = useWireOutRecords(
    pendingServed.map((w) => w.id),
    stellar,
  );
  useMinterPlusdId(stellar);

  const connected = wallet.isConnected && !!wallet.address;
  const accessEnabled = stellar && connected;
  const settleAccess = useWireOutAccess("settle_wire_out", accessEnabled);
  const cancelAccess = useWireOutAccess("cancel_wire_out", accessEnabled);

  const rows: WireOutRow[] = served.map((wire: CashBookWireOut) => {
    const readIndex = pendingServed.findIndex((w) => w.id === wire.id);
    const read = readIndex === -1 ? undefined : reads[readIndex];
    const chainState =
      readIndex === -1
        ? null
        : wireOutRowState(wire.status, {
            data: read?.data,
            isPending: read?.isPending ?? true,
            isError: read?.isError ?? false,
          });
    return {
      id: wire.id,
      status: wire.status,
      lenderName: wire.lp_legal_name ?? "—",
      lpId: wire.lp_id ?? null,
      lp: wire.lp,
      amount: plusdAmount(wire.amount),
      amountRaw: wire.amount,
      requestedAt: formatIsoDateTimeUtc(wire.requested_at),
      settledAt: formatIsoDateTimeUtc(wire.settled_at),
      valueDate: formatIsoDateUtc(wire.value_date),
      refHash: wire.ref_hash ?? null,
      cancelledAt: formatIsoDateTimeUtc(wire.cancelled_at),
      chainState,
      chainLabel:
        chainState === null
          ? "—"
          : wireOutStateLabel(chainState, read?.data?.status),
      record: read?.data ?? null,
    };
  });

  const pendingKey = rows
    .filter((r) => r.chainState?.endsWith("pending-index"))
    .map((r) => r.id)
    .join(",");
  useEffect(() => {
    const ids = pendingKey === "" ? [] : pendingKey.split(",").map(Number);
    setPendingIds(ids);
    for (const id of ids) {
      if (timers.current.has(id)) continue;
      timers.current.set(
        id,
        setTimeout(
          () => setExpired((prev) => new Set(prev).add(id)),
          WIRE_OUT_PENDING_WINDOW_MS,
        ),
      );
    }
    for (const [id, timer] of [...timers.current]) {
      if (ids.includes(id)) continue;
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, [pendingKey]);
  useEffect(() => {
    const live = timers.current;
    return () => {
      for (const timer of live.values()) clearTimeout(timer);
    };
  }, []);

  const minterMismatch =
    !!cashBook.data &&
    !!ENV.STELLAR_YIELD_MINTER_ID &&
    cashBook.data.minter !== ENV.STELLAR_YIELD_MINTER_ID;
  const busy = !!settle?.submitting || !!cancel?.submitting;

  function actionReason(row: WireOutRow, fn: WireOutFn): string | null {
    if (!connected) {
      return "Connect your trustee wallet to act on bank wire-outs.";
    }
    if (
      !ENV.STELLAR_YIELD_MINTER_ID ||
      !ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID
    ) {
      return "Bank wire-out actions are not configured for this environment.";
    }
    if (minterMismatch) {
      return "The app's minter differs from the server's cash-book minter.";
    }
    const q = fn === "settle_wire_out" ? settleAccess : cancelAccess;
    const access = wireOutAccessReason(fn, {
      access: q.data,
      isPending: q.isPending,
      isError: q.isError,
    });
    if (access) return access;
    if (row.chainState !== null && row.chainState !== "confirmed") {
      return wireOutStateReason(row.chainState, row.record?.status);
    }
    if (busy) return "Another action is in flight. Wait for it to finish.";
    return null;
  }

  function closeSettle() {
    if (settle?.submitting) return;
    token.current += 1;
    setSettle(null);
    settleMutation.reset();
  }

  function openSettle(row: WireOutRow) {
    if (actionReason(row, "settle_wire_out") !== null || !row.record) return;
    settleMutation.reset();
    token.current += 1;
    setSettle({
      row,
      record: row.record,
      amountInput: rawToDecimal7(row.record.amount),
      valueDateInput: todayUtcDateInput(),
      reference: "",
      refHash: null,
      error: null,
      submitting: false,
    });
  }

  function patchSettle(next: Partial<SettleDialogState>) {
    setSettle((prev) => (prev ? { ...prev, ...next } : prev));
  }

  function setAmountInput(amountInput: string) {
    patchSettle({ amountInput, error: null });
  }

  function setValueDateInput(valueDateInput: string) {
    patchSettle({ valueDateInput, error: null });
  }

  function setReference(reference: string) {
    patchSettle({ reference, refHash: null, error: null });
    if (reference.trim() === "") return;
    const mine = ++token.current;
    void wireInReturnRefHash(reference).then((refHash) => {
      if (mine !== token.current) return;
      patchSettle({ refHash });
    });
  }

  async function confirmSettle() {
    if (!settle || busy) return;
    if (settleValidation(settle) !== null) return;
    const { row, amountInput, valueDateInput, reference } = settle;
    const mine = token.current;
    patchSettle({ submitting: true, error: null });
    try {
      const refHash = await wireInReturnRefHash(reference);
      const seen = await readWireInRefHashSeen({
        minterId: ENV.STELLAR_YIELD_MINTER_ID,
        refHash,
        ...rpcOptions(),
      });
      if (mine !== token.current) return;
      if (seen) {
        patchSettle({
          submitting: false,
          refHash,
          error: {
            message: REUSED_BANK_REFERENCE_COPY,
            details: `ref_hash_seen(${refHash}) is true`,
            isSpecific: true,
          },
        });
        return;
      }
      const chain = await fetchWireOutRecord(row.id);
      if (mine !== token.current) return;
      if (chain.status !== "Pending") {
        patchSettle({ submitting: false, error: notPending(chain) });
        return;
      }
      const mismatch = settleFormError({
        amountInput,
        amountRaw: chain.amount,
        valueDateInput,
        today: todayUtcDateInput(),
        reference,
      });
      if (mismatch !== null) {
        patchSettle({
          submitting: false,
          error: {
            message: mismatch,
            details: `wire_out(${chain.id}).amount is ${chain.amount}`,
            isSpecific: true,
          },
        });
        return;
      }
      let hash: string;
      try {
        ({ hash } = await settleMutation.mutateAsync({
          id: row.id,
          amountRaw: chain.amount,
          valueDate: valueDateSeconds(valueDateInput),
          refHash,
        }));
      } catch (error) {
        patchSettle({
          submitting: false,
          error: wireOutErrorCopy("settle_wire_out", error),
        });
        return;
      }
      setLastResult(await afterSettle(row.id, hash));
      token.current += 1;
      setSettle(null);
    } catch (error) {
      if (mine !== token.current) return;
      patchSettle({
        submitting: false,
        error: wireOutErrorCopy("settle_wire_out", error),
      });
    }
  }

  async function afterSettle(id: number, hash: string): Promise<WireOutResult> {
    try {
      const chain = await fetchWireOutRecord(id);
      return { kind: "settled", id, hash, status: chain.status };
    } catch {
      return { kind: "unverified", id, hash, action: "settled" };
    }
  }

  function closeCancel() {
    if (cancel?.submitting) return;
    token.current += 1;
    setCancel(null);
    cancelMutation.reset();
  }

  async function readAuthorization(lp: string): Promise<PlusdAuthorization> {
    const plusdId = await ensureMinterPlusdId(queryClient);
    return readPlusdAuthorization({
      plusdId,
      address: lp,
      ...rpcOptions(),
    });
  }

  async function openCancel(row: WireOutRow) {
    if (actionReason(row, "cancel_wire_out") !== null) return;
    cancelMutation.reset();
    const mine = ++token.current;
    setCancel({ row, phase: "reading", error: null, submitting: false });
    try {
      const phase = await readAuthorization(row.lp);
      if (mine !== token.current) return;
      setCancel({ row, phase, error: null, submitting: false });
    } catch (error) {
      if (mine !== token.current) return;
      setCancel({
        row,
        phase: "read-error",
        error: readFailure(
          "Could not check the lender's PLUSD authorisation.",
          error,
        ),
        submitting: false,
      });
    }
  }

  function patchCancel(next: Partial<CancelDialogState>) {
    setCancel((prev) => (prev ? { ...prev, ...next } : prev));
  }

  async function confirmCancel() {
    if (!cancel || cancel.phase !== "authorized" || busy) return;
    const { row } = cancel;
    const mine = token.current;
    patchCancel({ submitting: true, error: null });
    try {
      const chain = await fetchWireOutRecord(row.id);
      if (mine !== token.current) return;
      if (chain.status !== "Pending") {
        patchCancel({ submitting: false, error: notPending(chain) });
        return;
      }
      const auth = await readAuthorization(chain.lp);
      if (mine !== token.current) return;
      if (auth !== "authorized") {
        patchCancel({ submitting: false, phase: auth });
        return;
      }
      let hash: string;
      try {
        ({ hash } = await cancelMutation.mutateAsync({ id: row.id }));
      } catch (error) {
        patchCancel({
          submitting: false,
          error: wireOutErrorCopy("cancel_wire_out", error),
        });
        return;
      }
      setLastResult(await afterCancel(row.id, hash, chain.lp));
      token.current += 1;
      setCancel(null);
    } catch (error) {
      if (mine !== token.current) return;
      patchCancel({
        submitting: false,
        error: wireOutErrorCopy("cancel_wire_out", error),
      });
    }
  }

  async function afterCancel(
    id: number,
    hash: string,
    lp: string,
  ): Promise<WireOutResult> {
    try {
      const chain = await fetchWireOutRecord(id);
      return { kind: "cancelled", id, hash, status: chain.status, lp };
    } catch {
      return { kind: "unverified", id, hash, action: "cancelled" };
    }
  }

  const error = cashBook.error
    ? cashBookError(cashBook.error, chainLabel)
    : null;
  const state: WireOutSectionState = !stellar
    ? "unsupported"
    : cashBook.isPending
      ? "loading"
      : cashBook.isError && !cashBook.data
        ? "error"
        : rows.length === 0
          ? "empty"
          : "ready";

  return {
    chainLabel,
    kind,
    state,
    unsupportedReason: `Bank wire-outs on ${chainLabel} are not available in the Trustee app yet.`,
    emptyMessage: `No bank wire-outs on ${chainLabel}.`,
    error: state === "error" ? error : null,
    refresh: () => void cashBook.refetch(),
    rows,
    actionReason,
    minterMismatch,
    lastResult,
    dismissResult: () => setLastResult(null),
    settle,
    openSettle,
    closeSettle,
    setAmountInput,
    setValueDateInput,
    setReference,
    confirmSettle,
    settleStage: settleMutation.stage,
    cancel,
    openCancel,
    closeCancel,
    confirmCancel,
    cancelStage: cancelMutation.stage,
    busy,
  };
}

export type WireOutsSection = ReturnType<typeof useWireOutsSection>;
