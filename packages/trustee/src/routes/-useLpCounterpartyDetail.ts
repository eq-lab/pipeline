// spec: docs/frontend/trustee-flows.md#lp-counterparties
import { useRef, useState } from "react";
import { useLp, type LpDetail } from "@/api/useLp";
import { useReviewLp, type LpReviewInput } from "@/api/useReviewLp";
import { ApiError } from "@/api/client";
import { formatIsoDateUtc } from "@/utils/formatDate";

export function lpError(error: Error | null) {
  if (!error) return null;
  const status = error instanceof ApiError ? error.status : undefined;
  const message =
    status === 401
      ? "Your session expired. Sign in again."
      : status === 403
        ? "Your trustee account is not authorized to review LP counterparties."
        : status === 404
          ? "This LP or document was not found. Refresh the account details."
          : status === 409
            ? "This account or document has changed and can no longer be reviewed. The latest details have been requested."
            : status === 400
              ? "Check the decision and reason, then try again."
              : "Could not complete the request. Check your connection and try again.";
  return { message, details: error.message };
}

function metaClause(prefix: string, iso: string | null | undefined) {
  const formatted = formatIsoDateUtc(iso);
  return formatted === "—" ? null : `${prefix} ${formatted}`;
}

export function lpHeroMeta(lp: LpDetail): string {
  return [
    lp.country || null,
    metaClause("Registered", lp.created_at),
    metaClause("Submitted", lp.kyb_submitted_at),
    metaClause("Decided", lp.kyb_decided_at),
  ]
    .filter((clause): clause is string => clause !== null)
    .join(" · ");
}

export interface LpReviewAction {
  decision: LpReviewInput["decision"];
  documentId?: number;
  filename?: string;
}

export function useLpCounterpartyDetail(rawId: string) {
  const id = /^\d+$/.test(rawId) ? Number(rawId) : NaN;
  const validId = Number.isSafeInteger(id) && id > 0;
  const query = useLp(id);
  const mutation = useReviewLp();
  const [action, setAction] = useState<LpReviewAction | null>(null);
  const [reason, setReason] = useState("");
  const submitting = useRef(false);
  const lp = query.data;
  const canReview = lp?.kyb_status === "UnderReview" && !query.isError;
  const canPass =
    canReview &&
    Boolean(lp?.documents.length) &&
    lp!.documents.every((document) => document.status === "Verified");
  const eligible = Boolean(
    action &&
    canReview &&
    (action.documentId === undefined
      ? action.decision !== "Passed" || canPass
      : lp?.documents.some(
          (document) =>
            document.id === action.documentId && document.status === "Provided",
        )),
  );
  const reasonLength = Array.from(reason.trim()).length;
  const validationError =
    action?.decision === "Rejected" && !reason.trim()
      ? "Enter a reason for rejecting this document."
      : action?.documentId === undefined && reasonLength > 2000
        ? "Reason must be at most 2,000 characters."
        : null;

  function open(next: LpReviewAction) {
    if (submitting.current) return;
    mutation.reset();
    setReason("");
    setAction(next);
  }
  function close() {
    if (submitting.current) return;
    setAction(null);
    setReason("");
    mutation.reset();
  }
  async function submit() {
    if (!action || !eligible || validationError || submitting.current) return;
    submitting.current = true;
    try {
      await mutation.mutateAsync({
        id,
        documentId: action.documentId,
        decision: action.decision,
        reason,
      });
      setAction(null);
      setReason("");
    } catch {
      return;
    } finally {
      submitting.current = false;
    }
  }
  return {
    lp,
    query,
    validId,
    canReview,
    canPass,
    action,
    reason,
    setReason,
    eligible,
    validationError,
    open,
    close,
    submit,
    busy: mutation.isPending,
    error: lpError(query.error),
    mutationError: lpError(mutation.error),
    refresh: () => void query.refetch(),
  };
}
