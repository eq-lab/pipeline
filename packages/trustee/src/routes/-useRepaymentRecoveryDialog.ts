// spec: docs/frontend/trustee-flows.md#repayment-recovery-1711
import { useEffect, useMemo, useState } from "react";
import type { RepaymentInput } from "@pipeline/wallet-connect";
import { useLoanBook } from "@/api/useLoanBook";
import { useAuditLog } from "@/api/useAuditLog";
import { useLoanFinancials } from "@/api/useLoanFinancials";
import { useLoanWaterfall } from "@/api/useLoanWaterfall";
import { useRecordPayment } from "@/api/useRecordPayment";
import {
  useExecuteReverseRepay,
  useRecoveryCandidates,
  useReverseRepayAccess,
  useScheduleReverseRepay,
  type RecoveryRow,
} from "@/api/useRepaymentRecovery";
import { findLoanEntry } from "@/lib/loanRoute";
import { stellarOnlyActionReason } from "@/lib/targetChains";
import { toUserError, type UserFacingError } from "@/utils/userError";
import {
  candidateRows,
  correctedRepaymentInput,
  defaultSelection,
  hasServedPositive,
  isRecoveryEligible,
  originalValueDate,
  recoveryCardState,
  recoveryErrorCopy,
  reverseAction,
  reversalEffects,
  type CandidateRow,
  type LabelValue,
  type RecoveryCardState,
  type ReverseAction,
} from "./-repayment-recovery";

export interface RecoveryDialogView {
  loading: boolean;
  loadError: UserFacingError | null;
  candidates: CandidateRow[];
  selectedId: number | null;
  select: (repaymentId: number) => void;
  selectedRow: RecoveryRow | null;
  effects: LabelValue[];
  action: ReverseAction | null;
  accessLoading: boolean;
  readyAt: number | null;
  delaySeconds: number | null;
  reverseStage: string | null;
  reversePending: boolean;
  reverseError: UserFacingError | null;
  reverse: () => void;
  step2: {
    enabled: boolean;
    blockedReason: string | null;
    corrected: RepaymentInput | null;
    valueDate: number | null;
    canRepay: boolean;
    stage: string | null;
    pending: boolean;
    error: UserFacingError | null;
    hash: string | null;
    record: () => void;
  };
}

function mapError(
  mode: "schedule" | "execute",
  error: Error | null,
  fallback: string,
): UserFacingError | null {
  if (error == null) return null;
  const mapped = toUserError(error, fallback);
  const copy = recoveryErrorCopy(mode, mapped.details);
  return copy ? { ...mapped, message: copy, isSpecific: true } : mapped;
}

export function useRepaymentRecoveryDialog(
  chainId: number,
  loanId: string,
  onchainStatus: string | null,
  open: boolean,
): RecoveryDialogView {
  const candidatesQuery = useRecoveryCandidates(chainId, loanId, onchainStatus);
  const rows = useMemo(
    () => candidatesQuery.data?.rows ?? [],
    [candidatesQuery.data],
  );
  const candidates = useMemo(
    () => candidateRows(rows, chainId),
    [rows, chainId],
  );

  const [picked, setPicked] = useState<number | null>(null);
  const fallbackId = useMemo(
    () => defaultSelection(rows, chainId),
    [rows, chainId],
  );
  const selectedId = picked ?? fallbackId;
  const selectedRow = rows.find((r) => r.repaymentId === selectedId) ?? null;
  const reversed = selectedRow?.reversed === true;

  useEffect(() => {
    if (!open) {
      setPicked(null);
      setRecordedHash(null);
    }
  }, [open]);

  const accessQuery = useReverseRepayAccess(
    Number(loanId),
    selectedId,
    open && selectedRow !== null,
  );
  const access = accessQuery.data;
  const action = reverseAction(
    access?.canReverse,
    access?.schedule ?? undefined,
  );

  const schedule = useScheduleReverseRepay();
  const execute = useExecuteReverseRepay();
  const recordPayment = useRecordPayment();
  const [recordedHash, setRecordedHash] = useState<string | null>(null);

  const financials = useLoanFinancials(chainId, loanId);
  const audit = useAuditLog();
  const valueDate = useMemo(
    () =>
      selectedId === null
        ? null
        : originalValueDate(audit.data?.items, chainId, loanId, selectedId),
    [audit.data, chainId, loanId, selectedId],
  );
  const waterfall = useLoanWaterfall(
    chainId,
    loanId,
    reversed && selectedRow ? selectedRow.repayment.offtaker_received : "",
    valueDate,
  );
  const corrected =
    reversed && selectedRow
      ? correctedRepaymentInput(selectedRow.repayment, waterfall.data)
      : null;
  const indexed = hasServedPositive(financials.data?.offtaker_outstanding);
  const canRepay = access?.canRepay.immediate === true;

  let blockedReason: string | null = null;
  if (!reversed) blockedReason = "Reverse the repayment first.";
  else if (valueDate === null) {
    blockedReason =
      "The original value date was not found in the audit log, so the corrected repayment cannot be recorded here.";
  } else if (!indexed) {
    blockedReason = "Waiting for the backend to index the reversal.";
  } else if (corrected === null) {
    blockedReason = waterfall.error
      ? "The corrected split could not be computed."
      : "Computing the corrected split.";
  } else if (!canRepay) {
    blockedReason =
      "Only the Cash reporter can record the corrected repayment.";
  }

  const reverseMutation = action === "schedule" ? schedule : execute;
  const reverseMode = action === "schedule" ? "schedule" : "execute";

  return {
    loading: candidatesQuery.isLoading,
    loadError: candidatesQuery.error
      ? toUserError(candidatesQuery.error, "Failed to load the repayments.")
      : null,
    candidates,
    selectedId,
    select: setPicked,
    selectedRow,
    effects: selectedRow ? reversalEffects(selectedRow.minter, chainId) : [],
    action,
    accessLoading: accessQuery.isLoading,
    readyAt: access?.schedule?.readyAt || null,
    delaySeconds: access?.canReverse.delay ?? null,
    reverseStage: reverseMutation.stage,
    reversePending: reverseMutation.isPending,
    reverseError: mapError(
      reverseMode,
      reverseMutation.error,
      "Failed to submit the reversal.",
    ),
    reverse: () => {
      if (selectedId === null) return;
      void reverseMutation
        .mutateAsync({ loanId: Number(loanId), repaymentId: selectedId })
        .catch(() => {});
    },
    step2: {
      enabled: blockedReason === null,
      blockedReason,
      corrected,
      valueDate,
      canRepay,
      stage: recordPayment.stage,
      pending: recordPayment.isPending,
      error: recordPayment.error
        ? toUserError(recordPayment.error, "Failed to record the repayment.")
        : null,
      hash: recordedHash,
      record: () => {
        if (corrected === null || valueDate === null) return;
        void recordPayment
          .mutateAsync({
            loanId: Number(loanId),
            repayment: corrected,
            valueDate,
          })
          .then(({ hash }) => setRecordedHash(hash))
          .catch(() => {});
      },
    },
  };
}

export interface RecoveryCardView {
  state: RecoveryCardState;
  onchainStatus: string | null;
  blockedReason: string | null;
}

export function useRecoveryCard(
  chainId: number,
  loanId: string,
): RecoveryCardView {
  const loanBook = useLoanBook();
  const financials = useLoanFinancials(chainId, loanId);
  const entry = findLoanEntry(loanBook.data?.loans, chainId, loanId);
  const onchainStatus = entry?.onchain_status ?? null;
  const blockedReason = entry ? stellarOnlyActionReason(entry.chain_id) : null;
  const candidates = useRecoveryCandidates(chainId, loanId, onchainStatus);

  const eligible = isRecoveryEligible({
    offtakerOutstanding: financials.data?.offtaker_outstanding,
    seniorOutstanding: entry?.senior_outstanding,
    onchainStatus,
  });
  return {
    state: recoveryCardState({
      eligible,
      onchainStatus,
      latestReversed: candidates.data?.latestReversed === true,
      evmBlocked: blockedReason !== null,
    }),
    onchainStatus,
    blockedReason,
  };
}
