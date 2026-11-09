// spec: docs/frontend/trustee-flows.md#cash-management--escrowed-wires
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  readPlusdAuthorization,
  readWireInRefHashSeen,
  useStellarWallet,
  wireInReturnRefHash,
  type MinterWireIn,
  type PlusdAuthorization,
  type RelayStage,
} from "@pipeline/wallet-connect";
import { useSessionState } from "@/auth/sessionStore";
import { fetchLp } from "@/api/useLp";
import { useLps, type LpSummary } from "@/api/useLps";
import { useCashBook, type CashBookWireIn } from "@/api/useCashBook";
import {
  ensureMinterPlusdId,
  fetchMinterWireIn,
  useAssignWireIn,
  useMinterPlusdId,
  useMinterWireIns,
  useReturnWireIn,
  useWireEscrowAccess,
  type WireEscrowFn,
} from "@/api/useEscrowedWires";
import { ENV } from "@/lib/env";
import { targetChainLabel } from "@/lib/targetChains";
import {
  NOT_IN_ESCROW_COPY,
  REUSED_REFERENCE_COPY,
  cashBookError,
  escrowAccessReason,
  onChainRowState,
  onChainStateLabel,
  onChainStateReason,
  wireEscrowErrorCopy,
  type OnChainRowState,
} from "@/lib/wireEscrow";
import { chainKindOf } from "./-settlementAddresses";
import { formatIsoDateTimeUtc } from "@/utils/formatDate";
import { formatUsdExact } from "@/utils/formatUsd";
import type { UserFacingError } from "@/utils/userError";

export const ESCROW_REFETCH_MS = 30_000;
export const ESCROW_PENDING_REFETCH_MS = 5_000;
export const ESCROW_PENDING_WINDOW_MS = 120_000;
export const RETURN_REFERENCE_MAX = 140;

export type EscrowSectionState =
  | "unsupported"
  | "loading"
  | "error"
  | "empty"
  | "ready";

export interface EscrowRow {
  id: number;
  amount: string;
  amountRaw: string;
  valueDate: string;
  valueDateIso: string;
  refHash: string;
  recordedAt: string;
  chainState: OnChainRowState;
  chainLabel: string;
}

export type AssignPhase =
  | "select"
  | "reading"
  | "authorized"
  | "not-authorized"
  | "no-trustline"
  | "read-error";

export interface AssignDialogState {
  row: EscrowRow;
  lpId: number | null;
  receiver: string | null;
  phase: AssignPhase;
  notice: string | null;
  error: UserFacingError | null;
  submitting: boolean;
}

export interface ReturnDialogState {
  row: EscrowRow;
  reference: string;
  refHash: string | null;
  error: UserFacingError | null;
  submitting: boolean;
}

export type EscrowResult =
  | {
      kind: "assigned";
      id: number;
      hash: string;
      legalName: string;
      receiver: string;
      status: string;
    }
  | {
      kind: "returned";
      id: number;
      hash: string;
      returnRef: string;
      status: string;
    }
  | {
      kind: "unverified";
      id: number;
      hash: string;
      action: "assigned" | "returned";
    };

export function escrowResultMessage(result: EscrowResult): string {
  const tail = `Transaction ${result.hash}. It leaves this list once indexed.`;
  if (result.kind === "assigned") {
    return `Wire #${result.id} assigned on-chain to ${result.legalName} (${result.receiver}). Status ${result.status}. ${tail}`;
  }
  if (result.kind === "returned") {
    return `Wire #${result.id} returned on-chain. Status ${result.status}, return reference ${result.returnRef}. ${tail}`;
  }
  return `Wire #${result.id} ${result.action} on-chain, but the result could not be re-read. Refresh the list. ${tail}`;
}

export function returnReferenceError(reference: string): string | null {
  const trimmed = reference.trim();
  if (trimmed === "") return "Enter the outgoing wire's bank reference.";
  if (trimmed.length > RETURN_REFERENCE_MAX) {
    return `The reference can be at most ${RETURN_REFERENCE_MAX} characters.`;
  }
  return null;
}

export function lpOptions(lps: LpSummary[] | undefined): LpSummary[] {
  return (lps ?? [])
    .filter((lp) => !!lp.stellar_address && !!lp.address_linked_at)
    .sort((a, b) => a.legal_name.localeCompare(b.legal_name));
}

function readFailure(message: string, error: unknown): UserFacingError {
  return {
    message,
    details: error instanceof Error ? error.message : String(error),
    isSpecific: true,
  };
}

function notInEscrow(chain: MinterWireIn): UserFacingError {
  return {
    message: NOT_IN_ESCROW_COPY,
    details: `wire_in(${chain.id}) status is ${chain.status}`,
    isSpecific: true,
  };
}

export function useEscrowedWiresSection() {
  const chainId = useSessionState().chainId ?? ENV.STELLAR_CHAIN_ID;
  const kind = chainKindOf(chainId);
  const chainLabel = targetChainLabel(chainId);
  const stellar = kind === "stellar";
  const wallet = useStellarWallet();
  const queryClient = useQueryClient();
  const lpsQuery = useLps();
  const assignMutation = useAssignWireIn();
  const returnMutation = useReturnWireIn();
  const [assign, setAssign] = useState<AssignDialogState | null>(null);
  const [ret, setRet] = useState<ReturnDialogState | null>(null);
  const [lastResult, setLastResult] = useState<EscrowResult | null>(null);
  const [expired, setExpired] = useState<ReadonlySet<number>>(() => new Set());
  const [pendingIds, setPendingIds] = useState<number[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const token = useRef(0);

  const fastPoll = pendingIds.some((id) => !expired.has(id));
  const cashBook = useCashBook(chainId, {
    enabled: stellar,
    refetchMs: fastPoll ? ESCROW_PENDING_REFETCH_MS : ESCROW_REFETCH_MS,
  });
  const served = useMemo(
    () =>
      (cashBook.data?.wire_ins ?? []).filter((w) => w.status === "Escrowed"),
    [cashBook.data],
  );
  const reads = useMinterWireIns(
    served.map((w) => w.id),
    stellar,
  );
  useMinterPlusdId(stellar);

  const connected = wallet.isConnected && !!wallet.address;
  const accessEnabled = stellar && connected;
  const assignAccess = useWireEscrowAccess("assign_wire_in", accessEnabled);
  const returnAccess = useWireEscrowAccess("return_wire_in", accessEnabled);

  const rows: EscrowRow[] = served.map((wire: CashBookWireIn, index) => {
    const read = reads[index];
    const chainState = onChainRowState(wire.status, {
      data: read?.data,
      isPending: read?.isPending ?? true,
      isError: read?.isError ?? false,
    });
    return {
      id: wire.id,
      amount: formatUsdExact(wire.amount),
      amountRaw: wire.amount,
      valueDate: formatIsoDateTimeUtc(wire.value_date),
      valueDateIso: wire.value_date,
      refHash: wire.ref_hash,
      recordedAt: formatIsoDateTimeUtc(wire.recorded_at),
      chainState,
      chainLabel: onChainStateLabel(chainState, read?.data?.status),
    };
  });

  const pendingKey = rows
    .filter((r) => r.chainState.endsWith("pending-index"))
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
          ESCROW_PENDING_WINDOW_MS,
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
  const busy = !!assign?.submitting || !!ret?.submitting;

  function actionReason(row: EscrowRow, fn: WireEscrowFn): string | null {
    if (!connected) {
      return "Connect your trustee wallet to act on escrowed wires.";
    }
    if (
      !ENV.STELLAR_YIELD_MINTER_ID ||
      !ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID
    ) {
      return "Escrowed-wire actions are not configured for this environment.";
    }
    if (minterMismatch) {
      return "The app's minter differs from the server's cash-book minter.";
    }
    const q = fn === "assign_wire_in" ? assignAccess : returnAccess;
    const access = escrowAccessReason(fn, {
      access: q.data,
      isPending: q.isPending,
      isError: q.isError,
    });
    if (access) return access;
    const chain = reads[rows.findIndex((r) => r.id === row.id)]?.data;
    const chainReason = onChainStateReason(row.chainState, chain?.status);
    if (chainReason) return chainReason;
    if (busy) return "Another action is in flight. Wait for it to finish.";
    return null;
  }

  const lps = lpOptions(lpsQuery.data?.lps);

  function closeAssign() {
    if (assign?.submitting) return;
    token.current += 1;
    setAssign(null);
    assignMutation.reset();
  }

  function openAssign(row: EscrowRow) {
    if (actionReason(row, "assign_wire_in") !== null) return;
    assignMutation.reset();
    token.current += 1;
    setAssign({
      row,
      lpId: null,
      receiver: null,
      phase: "select",
      notice: null,
      error: null,
      submitting: false,
    });
  }

  async function selectLp(lpId: number | null) {
    if (!assign) return;
    const row = assign.row;
    const lp = lps.find((candidate) => candidate.id === lpId);
    const mine = ++token.current;
    if (!lp || !lp.stellar_address) {
      setAssign({
        row,
        lpId: null,
        receiver: null,
        phase: "select",
        notice: null,
        error: null,
        submitting: false,
      });
      return;
    }
    const receiver = lp.stellar_address;
    setAssign({
      row,
      lpId: lp.id,
      receiver,
      phase: "reading",
      notice: null,
      error: null,
      submitting: false,
    });
    try {
      const plusdId = await ensureMinterPlusdId(queryClient);
      const phase = await readPlusdAuthorization({
        plusdId,
        address: receiver,
        rpcUrl: ENV.STELLAR_RPC_URL,
        networkPassphrase: ENV.STELLAR_NETWORK_PASSPHRASE,
      });
      if (mine !== token.current) return;
      setAssign({
        row,
        lpId: lp.id,
        receiver,
        phase,
        notice: null,
        error: null,
        submitting: false,
      });
    } catch (error) {
      if (mine !== token.current) return;
      setAssign({
        row,
        lpId: lp.id,
        receiver,
        phase: "read-error",
        notice: null,
        error: readFailure(
          "Could not read this lender's PLUSD authorisation. Try again.",
          error,
        ),
        submitting: false,
      });
    }
  }

  async function confirmAssign() {
    if (!assign || assign.phase !== "authorized" || busy) return;
    if (assign.lpId === null || assign.receiver === null) return;
    const { row, lpId, receiver } = assign;
    const mine = token.current;
    const patch = (next: Partial<AssignDialogState>) =>
      setAssign((prev) => (prev ? { ...prev, ...next } : prev));
    patch({ submitting: true, error: null });
    try {
      const fresh = await fetchLp(lpId);
      if (mine !== token.current) return;
      if (fresh.stellar_address !== receiver || !fresh.address_linked_at) {
        setAssign({
          row,
          lpId: null,
          receiver: null,
          phase: "select",
          notice:
            "This lender's settlement address changed. Select the lender again.",
          error: null,
          submitting: false,
        });
        void lpsQuery.refetch();
        return;
      }
      const chain = await fetchMinterWireIn(row.id);
      if (chain.status !== "Escrowed") {
        patch({ submitting: false, error: notInEscrow(chain) });
        return;
      }
      const plusdId = await ensureMinterPlusdId(queryClient);
      const auth: PlusdAuthorization = await readPlusdAuthorization({
        plusdId,
        address: receiver,
        rpcUrl: ENV.STELLAR_RPC_URL,
        networkPassphrase: ENV.STELLAR_NETWORK_PASSPHRASE,
      });
      if (auth !== "authorized") {
        patch({ submitting: false, phase: auth });
        return;
      }
      let hash: string;
      try {
        ({ hash } = await assignMutation.mutateAsync({ id: row.id, receiver }));
      } catch (error) {
        patch({
          submitting: false,
          error: wireEscrowErrorCopy("assign_wire_in", error),
        });
        return;
      }
      setLastResult(
        await afterAssign(row.id, hash, fresh.legal_name, receiver),
      );
      token.current += 1;
      setAssign(null);
    } catch (error) {
      if (mine !== token.current) return;
      patch({
        submitting: false,
        error: wireEscrowErrorCopy("assign_wire_in", error),
      });
    }
  }

  async function afterAssign(
    id: number,
    hash: string,
    legalName: string,
    fallbackReceiver: string,
  ): Promise<EscrowResult> {
    try {
      const chain = await fetchMinterWireIn(id);
      return {
        kind: "assigned",
        id,
        hash,
        legalName,
        receiver: chain.receiver || fallbackReceiver,
        status: chain.status,
      };
    } catch {
      return { kind: "unverified", id, hash, action: "assigned" };
    }
  }

  function closeReturn() {
    if (ret?.submitting) return;
    token.current += 1;
    setRet(null);
    returnMutation.reset();
  }

  function openReturn(row: EscrowRow) {
    if (actionReason(row, "return_wire_in") !== null) return;
    returnMutation.reset();
    token.current += 1;
    setRet({
      row,
      reference: "",
      refHash: null,
      error: null,
      submitting: false,
    });
  }

  function setReference(reference: string) {
    setRet((prev) =>
      prev ? { ...prev, reference, refHash: null, error: null } : prev,
    );
    if (returnReferenceError(reference) !== null) return;
    const mine = ++token.current;
    void wireInReturnRefHash(reference).then((refHash) => {
      if (mine !== token.current) return;
      setRet((prev) => (prev ? { ...prev, refHash } : prev));
    });
  }

  async function confirmReturn() {
    if (!ret || busy) return;
    if (returnReferenceError(ret.reference) !== null) return;
    const { row, reference } = ret;
    const mine = token.current;
    const patch = (next: Partial<ReturnDialogState>) =>
      setRet((prev) => (prev ? { ...prev, ...next } : prev));
    patch({ submitting: true, error: null });
    try {
      const refHash = await wireInReturnRefHash(reference);
      const seen = await readWireInRefHashSeen({
        minterId: ENV.STELLAR_YIELD_MINTER_ID,
        refHash,
        rpcUrl: ENV.STELLAR_RPC_URL,
        networkPassphrase: ENV.STELLAR_NETWORK_PASSPHRASE,
      });
      if (mine !== token.current) return;
      if (seen) {
        patch({
          submitting: false,
          refHash,
          error: {
            message: REUSED_REFERENCE_COPY,
            details: `ref_hash_seen(${refHash}) is true`,
            isSpecific: true,
          },
        });
        return;
      }
      const chain = await fetchMinterWireIn(row.id);
      if (chain.status !== "Escrowed") {
        patch({ submitting: false, error: notInEscrow(chain) });
        return;
      }
      let hash: string;
      try {
        ({ hash } = await returnMutation.mutateAsync({ id: row.id, refHash }));
      } catch (error) {
        patch({
          submitting: false,
          error: wireEscrowErrorCopy("return_wire_in", error),
        });
        return;
      }
      setLastResult(await afterReturn(row.id, hash));
      token.current += 1;
      setRet(null);
    } catch (error) {
      if (mine !== token.current) return;
      patch({
        submitting: false,
        error: wireEscrowErrorCopy("return_wire_in", error),
      });
    }
  }

  async function afterReturn(id: number, hash: string): Promise<EscrowResult> {
    try {
      const chain = await fetchMinterWireIn(id);
      return {
        kind: "returned",
        id,
        hash,
        returnRef: chain.returnRef,
        status: chain.status,
      };
    } catch {
      return { kind: "unverified", id, hash, action: "returned" };
    }
  }

  const error = cashBook.error
    ? cashBookError(cashBook.error, chainLabel)
    : null;
  const state: EscrowSectionState = !stellar
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
    unsupportedReason: `Escrowed wires on ${chainLabel} are not available in the Trustee app yet.`,
    error: state === "error" ? error : null,
    refresh: () => void cashBook.refetch(),
    rows,
    actionReason,
    minterMismatch,
    lastResult,
    dismissResult: () => setLastResult(null),
    lps,
    assign,
    openAssign,
    closeAssign,
    selectLp,
    confirmAssign,
    assignStage: assignMutation.stage,
    ret,
    openReturn,
    closeReturn,
    setReference,
    confirmReturn,
    returnStage: returnMutation.stage,
    busy,
  };
}

export type EscrowedWiresSection = ReturnType<typeof useEscrowedWiresSection>;

export function escrowStageLabel(
  stage: RelayStage | null,
  idle: string,
): string {
  switch (stage) {
    case "awaiting-signature":
      return "Awaiting signature…";
    case "submitting":
      return "Submitting…";
    case "confirming":
      return "Confirming…";
    default:
      return idle;
  }
}
