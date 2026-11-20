// spec: docs/frontend/trustee-flows.md#lp-bank-deposits
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useLpBankDeposits,
  useRecordBankDeposit,
  LP_BANK_DEPOSITS_REFETCH_MS,
  type LpBankDeposit,
} from "@/api/useLpBankDeposits";
import { fetchLp, useLp, type LpDetail } from "@/api/useLp";
import { useCashReporterAccess } from "@/api/useCashReporterAccess";
import { useRecordWireIn, type RecordWireInStage } from "@/api/useRecordWireIn";
import { ApiError } from "@/api/client";
import { ENV } from "@/lib/env";
import { useSessionState } from "@/auth/sessionStore";
import { targetChainLabel } from "@/lib/targetChains";
import { chainKindOf, type SettlementChainKind } from "./-settlementAddresses";
import {
  parseSorobanContractErrorCode,
  toUserError,
  type UserFacingError,
} from "@/utils/userError";
import { ensureMinterPlusdId } from "@/api/useEscrowedWires";
import {
  readPlusdAuthorization,
  useStellarWallet,
} from "@pipeline/wallet-connect";
import {
  formatIsoDateTimeUtc,
  nowUtcDateTimeInput,
  utcDateTimeInputToIso,
} from "@/utils/formatDate";
import { formatUsdDecimal, parseUsdCentsInput } from "@/utils/formatUsd";

export const MINT_PENDING_WINDOW_MS = 120_000;
export const MINT_PENDING_REFETCH_MS = 5_000;

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
          : status === 422
            ? error.message
            : status === 409
              ? "A deposit with this bank reference is already recorded."
              : status === 400
                ? "Check the amount, references and date, then try again."
                : "Could not complete the request. Check your connection and try again.";
  return { message, details: error.message };
}

export function mintError(error: Error | null): UserFacingError | null {
  if (!error) return null;
  const mapped = toUserError(
    error,
    "Could not mint PLUSD for this deposit. Please try again.",
  );
  if (/RefHashSeen/i.test(mapped.details)) {
    return {
      message:
        "This deposit's reference has already been minted on-chain. Refresh the list.",
      details: mapped.details,
      isSpecific: true,
    };
  }
  if (parseSorobanContractErrorCode(mapped.details) === 13) {
    return {
      message: "The receiver has no authorized PLUSD trustline.",
      details: mapped.details,
      isSpecific: true,
    };
  }
  if (parseSorobanContractErrorCode(mapped.details) === 15) {
    return {
      message: PLUSD_NOT_AUTHORIZED_COPY,
      details: mapped.details,
      isSpecific: true,
    };
  }
  return mapped;
}

export const PLUSD_NOT_AUTHORIZED_COPY =
  "This receiver's PLUSD trustline is not authorised yet. The relayer authorises a KYB-passed lender's linked address automatically; try again in a few minutes.";

export function plusdBlockMessage(
  phase: "no-trustline" | "not-authorized",
  isCapitalWallet: boolean,
): string {
  const holder = isCapitalWallet ? "capital wallet" : "lender";
  if (phase === "no-trustline") {
    return `This receiver has no PLUSD trustline. The ${holder} must add PLUSD to this wallet before it can receive a mint.`;
  }
  return isCapitalWallet
    ? "The capital wallet's PLUSD trustline is not authorised yet. Authorise it before minting."
    : PLUSD_NOT_AUTHORIZED_COPY;
}

export function mintStageLabel(stage: RecordWireInStage | null): string {
  switch (stage) {
    case "awaiting-signature":
      return "Awaiting signature…";
    case "submitting":
      return "Submitting…";
    case "confirming":
      return "Confirming…";
    default:
      return "Mint PLUSD";
  }
}

export interface CapitalWallets {
  stellar: string;
  evm: string;
}

export interface WireInReceiver {
  receiver: string;
  isCapitalWallet: boolean;
  kind: SettlementChainKind;
}

export function wireInReceiver(
  lp:
    | Pick<
        LpDetail,
        | "stellar_address"
        | "address_linked_at"
        | "evm_address"
        | "evm_address_linked_at"
      >
    | undefined,
  kind: SettlementChainKind,
  capitalWallets: CapitalWallets,
): WireInReceiver | null {
  const address = kind === "stellar" ? lp?.stellar_address : lp?.evm_address;
  const linkedAt =
    kind === "stellar" ? lp?.address_linked_at : lp?.evm_address_linked_at;
  if (address && linkedAt) {
    return { receiver: address, isCapitalWallet: false, kind };
  }
  const capitalWallet = capitalWallets[kind];
  if (capitalWallet) {
    return { receiver: capitalWallet, isCapitalWallet: true, kind };
  }
  return null;
}

export function sameReceiver(
  a: WireInReceiver | null,
  b: WireInReceiver | null,
): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.receiver === b.receiver &&
    a.isCapitalWallet === b.isCapitalWallet &&
    a.kind === b.kind
  );
}

export type MintConfirm =
  | { row: DepositRow; phase: "reading" }
  | { row: DepositRow; phase: "read-error"; error: UserFacingError }
  | { row: DepositRow; phase: "no-receiver" }
  | {
      row: DepositRow;
      phase: "no-trustline" | "not-authorized";
      receiver: WireInReceiver;
    }
  | {
      row: DepositRow;
      phase: "ready";
      receiver: WireInReceiver;
      previous: WireInReceiver | null;
      changed: boolean;
    };

export function noReceiverMessage(kind: SettlementChainKind): string {
  return `This LP has no linked ${kind === "stellar" ? "Stellar" : "EVM"} wallet and no capital wallet is configured.`;
}

export interface MatchedRow {
  paymentDetails: string;
  issuedAt: string;
  chainId: number | null;
  chainLabel: string;
  receiverAddress: string | null;
}

export interface DepositRow {
  id: number;
  occurredAt: string;
  occurredAtIso: string;
  amount: string;
  amountRaw: string;
  reference: string;
  refHash: string;
  isMinted: boolean;
  isPending: boolean;
  recordedBy: string;
  matched: MatchedRow | null;
}

export function matchedChainReason(
  row: DepositRow,
  sessionChainId: number,
): string | null {
  const matchedChain = row.matched?.chainId;
  if (matchedChain == null || matchedChain === sessionChainId) return null;
  const label = row.matched!.chainLabel;
  return `This wire was matched to a reference issued for ${label}. Sign in on ${label} to mint it.`;
}

export function mapDepositToRow(
  deposit: LpBankDeposit,
  isPending = false,
): DepositRow {
  return {
    id: deposit.id,
    occurredAt: formatIsoDateTimeUtc(deposit.occurred_at),
    occurredAtIso: deposit.occurred_at,
    amount: formatUsdDecimal(deposit.amount),
    amountRaw: deposit.amount,
    reference: deposit.payment_reference,
    refHash: deposit.ref_hash,
    isMinted: deposit.is_minted,
    isPending: !deposit.is_minted && isPending,
    recordedBy: deposit.recorded_by,
    matched: deposit.matched_reference
      ? {
          paymentDetails: deposit.matched_reference.payment_details,
          issuedAt: formatIsoDateTimeUtc(deposit.matched_reference.issued_at),
          chainId: deposit.matched_reference.chain_id,
          chainLabel: targetChainLabel(deposit.matched_reference.chain_id),
          receiverAddress: deposit.matched_reference.receiver_address,
        }
      : null,
  };
}

export function useLpBankDepositsSection(
  lpId: number,
  initialPaymentDetails?: string,
  onPrefillConsumed?: () => void,
) {
  const [pendingDeadlines, setPendingDeadlines] = useState<
    ReadonlyMap<number, number>
  >(() => new Map<number, number>());
  const query = useLpBankDeposits(
    lpId,
    pendingDeadlines.size > 0
      ? MINT_PENDING_REFETCH_MS
      : LP_BANK_DEPOSITS_REFETCH_MS,
  );
  const lpQuery = useLp(lpId);
  const mutation = useRecordBankDeposit();
  const wallet = useStellarWallet();
  const mint = useRecordWireIn();
  const queryClient = useQueryClient();
  const initialRef = useRef(
    initialPaymentDetails?.trim() ? initialPaymentDetails : undefined,
  );
  const [open, setOpen] = useState(initialRef.current !== undefined);
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [paymentDetails, setPaymentDetails] = useState(
    initialRef.current ?? "",
  );
  const [sentPaymentDetails, setSentPaymentDetails] = useState(false);
  const [occurredAt, setOccurredAt] = useState(nowUtcDateTimeInput);
  const [touched, setTouched] = useState(false);
  const [mintingDepositId, setMintingDepositId] = useState<number | null>(null);
  const submitting = useRef(false);
  const [confirm, setConfirm] = useState<MintConfirm | null>(null);
  const [ack, setAck] = useState(false);
  const readToken = useRef(0);

  const deposits = query.data?.deposits ?? [];
  const mintedIdsKey = deposits
    .filter((deposit) => deposit.is_minted)
    .map((deposit) => deposit.id)
    .join(",");

  useEffect(() => {
    if (pendingDeadlines.size === 0) return;
    const minted = new Set(
      mintedIdsKey === "" ? [] : mintedIdsKey.split(",").map(Number),
    );
    const next = new Map(
      [...pendingDeadlines].filter(([id]) => !minted.has(id)),
    );
    if (next.size !== pendingDeadlines.size) setPendingDeadlines(next);
  }, [mintedIdsKey, pendingDeadlines]);

  useEffect(() => {
    if (pendingDeadlines.size === 0) return;
    const now = Date.now();
    const timers = [...pendingDeadlines].map(([id, deadline]) =>
      setTimeout(
        () =>
          setPendingDeadlines((prev) => {
            if (!prev.has(id)) return prev;
            const next = new Map(prev);
            next.delete(id);
            return next;
          }),
        Math.max(0, deadline - now),
      ),
    );
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [pendingDeadlines]);

  const chainId = useSessionState().chainId ?? ENV.STELLAR_CHAIN_ID;
  const kind = chainKindOf(chainId);
  const chainLabel = targetChainLabel(chainId);
  const capitalWallets: CapitalWallets = {
    stellar: ENV.STELLAR_CAPITAL_WALLET_ID,
    evm: ENV.EVM_CAPITAL_WALLET_ADDRESS,
  };
  const receiver = wireInReceiver(lpQuery.data, kind, capitalWallets);
  const roleReason = useCashReporterAccess(
    "record_wire_in",
    kind === "stellar",
  ).reason;

  const mintDisabledReason = useCallback(
    (row: DepositRow): string | null => {
      if (kind === "evm") {
        return `PLUSD minting on ${chainLabel} is not available in the Trustee app yet.`;
      }
      const matchedReason = matchedChainReason(row, chainId);
      if (matchedReason !== null) return matchedReason;
      if (!wallet.isConnected || !wallet.address) {
        return "Connect your trustee wallet to mint PLUSD.";
      }
      if (!ENV.STELLAR_YIELD_MINTER_ID) {
        return "On-chain PLUSD minting is not configured for this environment.";
      }
      if (roleReason !== null) return roleReason;
      if (!receiver) {
        return noReceiverMessage(kind);
      }
      if (row.isMinted) return "This deposit is already minted.";
      if (row.isPending) {
        return "Submitted — waiting for the indexer to confirm the mint.";
      }
      if (mintingDepositId !== null) {
        return "Another mint is in flight. Wait for it to finish.";
      }
      return null;
    },
    [
      kind,
      chainId,
      chainLabel,
      wallet.isConnected,
      wallet.address,
      roleReason,
      receiver,
      mintingDepositId,
    ],
  );

  const normalizedAmount = parseUsdCentsInput(amount);
  const occurredIso = utcDateTimeInputToIso(occurredAt);
  const validationError = !normalizedAmount
    ? "Enter an amount greater than 0 with at most 2 decimal places."
    : !reference.trim()
      ? "Enter the bank's reference for this wire."
      : !occurredIso
        ? "Enter when the wire was received."
        : Date.parse(occurredIso) > Date.now()
          ? "The receipt time cannot be in the future."
          : null;

  function openDialog(prefill?: string) {
    if (submitting.current) return;
    mutation.reset();
    setAmount("");
    setReference("");
    setPaymentDetails(prefill ?? "");
    setSentPaymentDetails(false);
    setOccurredAt(nowUtcDateTimeInput());
    setTouched(false);
    setOpen(true);
  }
  const prefillConsumed = useRef(onPrefillConsumed);
  useEffect(() => {
    if (initialRef.current !== undefined) prefillConsumed.current?.();
  }, []);

  function close() {
    if (submitting.current) return;
    setOpen(false);
    mutation.reset();
  }
  async function submit() {
    setTouched(true);
    if (validationError || submitting.current) return;
    submitting.current = true;
    const details = paymentDetails.trim();
    setSentPaymentDetails(details !== "");
    try {
      await mutation.mutateAsync({
        lpId,
        amount: normalizedAmount!,
        payment_reference: reference.trim(),
        payment_details: details || undefined,
        occurred_at: occurredIso!,
      });
      setOpen(false);
    } catch {
      return;
    } finally {
      submitting.current = false;
    }
  }

  function readFailure(error: unknown): UserFacingError {
    return {
      message: "Could not re-read this LP's settlement address. Try again.",
      details: error instanceof Error ? error.message : String(error),
      isSpecific: true,
    };
  }

  function authorizationFailure(error: unknown): UserFacingError {
    return {
      message: "Could not read this receiver's PLUSD authorisation. Try again.",
      details: error instanceof Error ? error.message : String(error),
      isSpecific: true,
    };
  }

  async function readReceiverAuthorization(address: string) {
    return readPlusdAuthorization({
      plusdId: await ensureMinterPlusdId(queryClient),
      address,
      rpcUrl: ENV.STELLAR_RPC_URL,
      networkPassphrase: ENV.STELLAR_NETWORK_PASSPHRASE,
    });
  }

  async function openMint(row: DepositRow) {
    if (mintDisabledReason(row) !== null) return;
    mint.reset();
    setAck(false);
    const token = ++readToken.current;
    setConfirm({ row, phase: "reading" });
    try {
      const fresh = await fetchLp(lpId);
      if (token !== readToken.current) return;
      const next = wireInReceiver(fresh, kind, capitalWallets);
      if (next === null) {
        setConfirm({ row, phase: "no-receiver" });
        return;
      }
      const changed = !sameReceiver(next, receiver);
      let authorization;
      try {
        authorization = await readReceiverAuthorization(next.receiver);
      } catch (error) {
        if (token !== readToken.current) return;
        setConfirm({
          row,
          phase: "read-error",
          error: authorizationFailure(error),
        });
        return;
      }
      if (token !== readToken.current) return;
      if (authorization !== "authorized") {
        setConfirm({ row, phase: authorization, receiver: next });
        if (changed) void lpQuery.refetch();
        return;
      }
      setConfirm({
        row,
        phase: "ready",
        receiver: next,
        previous: receiver,
        changed,
      });
      if (changed) void lpQuery.refetch();
    } catch (error) {
      if (token !== readToken.current) return;
      setConfirm({ row, phase: "read-error", error: readFailure(error) });
    }
  }

  async function confirmMint() {
    if (
      !confirm ||
      confirm.phase !== "ready" ||
      (confirm.changed && !ack) ||
      mintingDepositId !== null
    ) {
      return;
    }
    const { row } = confirm;
    const token = readToken.current;
    setMintingDepositId(row.id);
    try {
      const fresh = await fetchLp(lpId);
      if (token !== readToken.current) return;
      const next = wireInReceiver(fresh, kind, capitalWallets);
      if (next === null) {
        setConfirm({ row, phase: "no-receiver" });
        return;
      }
      if (!sameReceiver(next, confirm.receiver)) {
        setConfirm({
          row,
          phase: "ready",
          receiver: next,
          previous: confirm.receiver,
          changed: true,
        });
        setAck(false);
        void lpQuery.refetch();
        return;
      }
      let authorization;
      try {
        authorization = await readReceiverAuthorization(next.receiver);
      } catch (error) {
        if (token !== readToken.current) return;
        setConfirm({
          row,
          phase: "read-error",
          error: authorizationFailure(error),
        });
        return;
      }
      if (token !== readToken.current) return;
      if (authorization !== "authorized") {
        setConfirm({ row, phase: authorization, receiver: next });
        return;
      }
      try {
        await mint.mutateAsync({
          lpId,
          depositId: row.id,
          receiver: next.receiver,
          amount: row.amountRaw,
          occurredAt: row.occurredAtIso,
          refHash: row.refHash,
        });
      } catch {
        return;
      }
      setPendingDeadlines((prev) =>
        new Map(prev).set(row.id, Date.now() + MINT_PENDING_WINDOW_MS),
      );
      readToken.current += 1;
      setConfirm(null);
    } catch (error) {
      if (token !== readToken.current) return;
      setConfirm({ row, phase: "read-error", error: readFailure(error) });
    } finally {
      setMintingDepositId(null);
    }
  }

  function closeMint() {
    if (mintingDepositId !== null) return;
    readToken.current += 1;
    setConfirm(null);
    mint.reset();
  }

  return {
    query,
    rows: deposits.map((deposit) =>
      mapDepositToRow(deposit, pendingDeadlines.has(deposit.id)),
    ),
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
    paymentDetails,
    setPaymentDetails,
    occurredAt,
    setOccurredAt,
    validationError: touched ? validationError : null,
    busy: mutation.isPending,
    mutationError: depositError(mutation.error),
    mutationEscrowHint:
      mutation.error instanceof ApiError &&
      mutation.error.status === 422 &&
      sentPaymentDetails,
    chainLabel,
    kind,
    receiver,
    confirm,
    ack,
    setAck,
    openMint,
    confirmMint,
    closeMint,
    mintDisabledReason,
    mintingDepositId,
    mintStage: mint.stage,
    mintError: mintError(mint.error),
  };
}

export type LpBankDepositsSection = ReturnType<typeof useLpBankDepositsSection>;
