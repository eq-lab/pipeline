// spec: docs/frontend/trustee-flows.md#lp-bank-deposits
import { useCallback, useEffect, useRef, useState } from "react";
import {
  useLpBankDeposits,
  useRecordBankDeposit,
  LP_BANK_DEPOSITS_REFETCH_MS,
  type LpBankDeposit,
} from "@/api/useLpBankDeposits";
import { useLp, type LpDetail } from "@/api/useLp";
import { useRecordWireIn, type RecordWireInStage } from "@/api/useRecordWireIn";
import { ApiError } from "@/api/client";
import { ENV } from "@/lib/env";
import {
  parseSorobanContractErrorCode,
  toUserError,
  type UserFacingError,
} from "@/utils/userError";
import { useStellarWallet } from "@pipeline/wallet-connect";
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
          : status === 409
            ? "A deposit with this payment reference is already recorded."
            : status === 400
              ? "Check the amount, payment reference, and date, then try again."
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
  return mapped;
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

export interface WireInReceiver {
  receiver: string;
  isCapitalWallet: boolean;
}

export function wireInReceiver(
  lp: Pick<LpDetail, "stellar_address" | "address_linked_at"> | undefined,
  capitalWalletId: string,
): WireInReceiver | null {
  if (lp?.stellar_address && lp.address_linked_at) {
    return { receiver: lp.stellar_address, isCapitalWallet: false };
  }
  if (capitalWalletId) {
    return { receiver: capitalWalletId, isCapitalWallet: true };
  }
  return null;
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
  minted: string;
  recordedBy: string;
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
    minted: deposit.is_minted ? "Minted" : isPending ? "Pending" : "Not minted",
    recordedBy: deposit.recorded_by,
  };
}

export function useLpBankDepositsSection(lpId: number) {
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
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [occurredAt, setOccurredAt] = useState(nowUtcDateTimeInput);
  const [touched, setTouched] = useState(false);
  const [mintingDepositId, setMintingDepositId] = useState<number | null>(null);
  const submitting = useRef(false);

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

  const receiver = wireInReceiver(lpQuery.data, ENV.STELLAR_CAPITAL_WALLET_ID);

  const mintDisabledReason = useCallback(
    (row: DepositRow): string | null => {
      if (!wallet.isConnected || !wallet.address) {
        return "Connect your trustee wallet to mint PLUSD.";
      }
      if (!ENV.STELLAR_YIELD_MINTER_ID) {
        return "On-chain PLUSD minting is not configured for this environment.";
      }
      if (!receiver) {
        return "This LP has no linked Stellar wallet and no capital wallet is configured.";
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
    [wallet.isConnected, wallet.address, receiver, mintingDepositId],
  );

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

  async function mintDeposit(row: DepositRow) {
    if (mintDisabledReason(row) !== null || !receiver) return;
    mint.reset();
    setMintingDepositId(row.id);
    try {
      await mint.mutateAsync({
        lpId,
        depositId: row.id,
        receiver: receiver.receiver,
        amount: row.amountRaw,
        occurredAt: row.occurredAtIso,
        refHash: row.refHash,
      });
      setPendingDeadlines((prev) =>
        new Map(prev).set(row.id, Date.now() + MINT_PENDING_WINDOW_MS),
      );
    } catch {
      return;
    } finally {
      setMintingDepositId(null);
    }
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
    occurredAt,
    setOccurredAt,
    validationError: touched ? validationError : null,
    busy: mutation.isPending,
    mutationError: depositError(mutation.error),
    receiver,
    mintDeposit,
    mintDisabledReason,
    mintingDepositId,
    mintStage: mint.stage,
    mintError: mintError(mint.error),
  };
}

export type LpBankDepositsSection = ReturnType<typeof useLpBankDepositsSection>;
