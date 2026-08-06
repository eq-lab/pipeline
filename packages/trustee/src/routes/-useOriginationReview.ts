/**
 * Page orchestration hook for the Origination details page's
 * Approve/Reject/Request-changes controls. Co-located with the route per
 * `docs/FRONTEND.md` rule 2 — `origination.$id.tsx` stays JSX-only; this
 * hook owns the reject-dialog, the request-changes-dialog, and the
 * approve-mint-confirmation-dialog open/close state, and maps mutation
 * errors to user-facing copy.
 *
 * spec: docs/frontend/trustee-flows.md#approve--mint-confirmation-dialog-838-figma-node-411613943,
 * docs/frontend/trustee-flows.md#chain-first-approve-ordering-831,
 * docs/frontend/trustee-flows.md#review-error-copy,
 * docs/frontend/trustee-flows.md#request-changes-1017.
 */
import { useState } from "react";
import { useReviewSubmission } from "@/api/useReviewSubmission";
import { useDrawLoan, type DrawLoanStage } from "@/api/useDrawLoan";
import { useLoanSubmissions } from "@/api/useLoanSubmissions";
import { ApiError, ApiUnauthorizedError } from "@/api/client";

export interface UseOriginationReviewResult {
  /**
   * Fires the chain-first Approve flow (mint, then review) — no-op if
   * already Approved. As of issue #838 this is invoked as the
   * `-ApproveMintDialog`'s "Mint loan" confirm action, not directly by the
   * page's Approve button (see `openApprove`).
   */
  approve: () => void;
  /** Opens the approve & mint confirmation dialog (issue #838). */
  openApprove: () => void;
  /** Closes the approve & mint dialog without minting. */
  cancelApprove: () => void;
  /** Opens the reason dialog. */
  openReject: () => void;
  /** Closes the reject-reason dialog without submitting. */
  cancelReject: () => void;
  /** Fires the Reject mutation with the given (already-trimmed) reason. */
  submitReject: (reason: string) => void;
  /** Opens the request-changes reason dialog (#1017). */
  openRequestChanges: () => void;
  /** Closes the request-changes dialog without submitting. */
  cancelRequestChanges: () => void;
  /**
   * Fires the ChangesRequested review mutation with the given
   * (already-trimmed) reason — a pure DB call, no on-chain step (#1017).
   */
  submitRequestChanges: (reason: string) => void;
  /** True while the mint, the review call, or Reject is in flight. */
  isPending: boolean;
  /**
   * Progress label for the "Mint loan" confirm action while minting (issue
   * #831 Open Question 5: "Waiting for wallet signature…" -> "Submitting
   * on-chain…" -> "Confirming…" -> "Finalizing approval…"). `null` when not
   * minting.
   */
  mintingLabel: string | null;
  /** User-facing error copy, mapped from the last failed step, or `null`. */
  errorMessage: string | null;
  /** Whether the approve & mint confirmation dialog is open (issue #838). */
  approveOpen: boolean;
  /** Whether the reject-reason dialog is open. */
  rejectOpen: boolean;
  /** Whether the request-changes reason dialog is open (#1017). */
  requestChangesOpen: boolean;
  /**
   * On-chain id of the loan drawn in this session (#876) — lets the Approved
   * banner deep-link to `/loans/{id}`. `null` before a successful mint, or if
   * the id couldn't be recovered from the tx (or after a page reload — the
   * mint mutation's data is not persisted; same accepted residual as the
   * idempotency marker).
   */
  mintedLoanId: number | null;
}

/** Maps a thrown review-mutation error to user-facing copy. `null` when there is no error. */
function mapReviewError(error: Error | null): string | null {
  if (!error) return null;

  if (error instanceof ApiUnauthorizedError) {
    return "Your session has expired or is not authorized. Please sign in again.";
  }

  if (error instanceof ApiError) {
    switch (error.status) {
      case 409:
        return "This submission has already been reviewed. Refresh to see the latest status.";
      case 403:
        return "You are not authorized to review submissions.";
      case 400:
        return error.message || "This request was invalid.";
      default:
        return error.message
          ? `Something went wrong: ${error.message}`
          : "Something went wrong. Please try again.";
    }
  }

  return "Something went wrong. Please try again.";
}

/**
 * Maps a thrown `useDrawLoan` (on-chain mint) error to user-facing copy.
 * Uses substring heuristics on the error message since wallet kits/Soroban
 * RPC don't expose a stable typed error taxonomy for "user rejected" vs.
 * other failures.
 */
function mapMintError(error: Error): string {
  const message = error.message;

  if (/simulation error/i.test(message)) {
    return `Could not verify the loan on-chain (${message}). No signature was requested — safe to retry.`;
  }
  if (/reject|cancel|declin|denied|dismiss/i.test(message)) {
    return "Signature cancelled. Click Approve again to retry.";
  }
  if (/not configured/i.test(message)) {
    return "On-chain minting isn't configured for this environment.";
  }
  if (/not connected/i.test(message)) {
    return "Connect your trustee wallet to approve on-chain.";
  }
  return `The on-chain transaction failed (${message}). Please try again.`;
}

/** Progress copy for each `useDrawLoan` stage, shown on the Approve button. */
function mintStageLabel(stage: DrawLoanStage | null): string {
  switch (stage) {
    case "awaiting-signature":
      return "Waiting for wallet signature…";
    case "submitting":
      return "Submitting on-chain…";
    case "confirming":
      return "Confirming…";
    default:
      return "Registering on-chain…";
  }
}

export function useOriginationReview(id: string): UseOriginationReviewResult {
  const reviewMutation = useReviewSubmission();
  const drawLoanMutation = useDrawLoan();
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [requestChangesOpen, setRequestChangesOpen] = useState(false);
  const submissionId = Number(id);

  // Shares the `["loan-submissions", ...]` query cache with
  // `useOriginationDetail` (same default — no `status` filter) so this
  // never triggers a second network fetch.
  const { data: submissions } = useLoanSubmissions();
  const submission = submissions?.find((s) => s.id === submissionId);

  // Fires the review call and, on success, closes the approve dialog (issue
  // #838) — the footer then flips to the Approved banner via the existing
  // list-invalidation-driven refetch (`-origination-detail.ts`).
  function fireApprovalReview() {
    reviewMutation.mutate(
      { id: submissionId, decision: "Approved" },
      { onSuccess: () => setApproveOpen(false) },
    );
  }

  function approve() {
    if (!submission) return;
    // No-double-mint guard: an already-Approved submission needs no further
    // on-chain action.
    if (submission.status === "Approved") return;

    // Idempotency guard — spec: docs/frontend/trustee-flows.md#chain-first-approve-ordering-831.
    if (drawLoanMutation.isSuccess) {
      fireApprovalReview();
      return;
    }

    const loanData = submission.loan_data;
    void (async () => {
      try {
        await drawLoanMutation.mutateAsync({ loanData });
      } catch {
        // Mint failed / wallet rejected — stay InReview, no review call.
        return;
      }
      fireApprovalReview();
    })();
  }

  function openApprove() {
    reviewMutation.reset();
    setApproveOpen(true);
  }

  // Skips resetting `drawLoanMutation` once it has already succeeded — see
  // the idempotency guard above.
  function cancelApprove() {
    setApproveOpen(false);
    reviewMutation.reset();
    if (!drawLoanMutation.isSuccess) {
      drawLoanMutation.reset();
    }
  }

  function openReject() {
    reviewMutation.reset();
    setRejectOpen(true);
  }

  function cancelReject() {
    setRejectOpen(false);
    reviewMutation.reset();
  }

  function submitReject(reason: string) {
    reviewMutation.mutate(
      { id: submissionId, decision: "Rejected", reason },
      { onSuccess: () => setRejectOpen(false) },
    );
  }

  // Request-changes trio (#1017) — mirrors the reject trio exactly: a pure DB
  // review call (no mint, no wallet), sharing `reviewMutation` and its
  // error mapping; the footer flips to the #950 Changes-requested banner via
  // the same list-invalidation refetch.
  function openRequestChanges() {
    reviewMutation.reset();
    setRequestChangesOpen(true);
  }

  function cancelRequestChanges() {
    setRequestChangesOpen(false);
    reviewMutation.reset();
  }

  function submitRequestChanges(reason: string) {
    reviewMutation.mutate(
      { id: submissionId, decision: "ChangesRequested", reason },
      { onSuccess: () => setRequestChangesOpen(false) },
    );
  }

  const errorMessage = drawLoanMutation.error
    ? mapMintError(drawLoanMutation.error)
    : reviewMutation.error
      ? drawLoanMutation.isSuccess
        ? `The loan minted on-chain successfully, but marking it Approved failed (${
            reviewMutation.error.message || "unknown error"
          }). This is a known limitation — contact support rather than retrying (Approve would attempt another on-chain mint).`
        : mapReviewError(reviewMutation.error)
      : null;

  const mintingLabel = drawLoanMutation.isPending
    ? mintStageLabel(drawLoanMutation.stage)
    : drawLoanMutation.isSuccess && reviewMutation.isPending
      ? "Finalizing approval…"
      : null;

  return {
    approve,
    openApprove,
    cancelApprove,
    openReject,
    cancelReject,
    submitReject,
    openRequestChanges,
    cancelRequestChanges,
    submitRequestChanges,
    isPending: drawLoanMutation.isPending || reviewMutation.isPending,
    mintingLabel,
    errorMessage,
    approveOpen,
    rejectOpen,
    requestChangesOpen,
    mintedLoanId: drawLoanMutation.mintedLoanId,
  };
}
