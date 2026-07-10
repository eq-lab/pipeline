/**
 * Page orchestration hook for the Origination details page's Approve/Reject
 * controls. Co-located with the route per `docs/FRONTEND.md` rule 2 —
 * `origination.$id.tsx` stays JSX-only; this hook owns the reject-dialog
 * open/close state and maps mutation errors to user-facing copy.
 *
 * ## Chain-first Approve ordering (issue #831)
 *
 * Approve now runs the trustee-wallet-signed on-chain `draw_loan` mint
 * (`useDrawLoan`, `@pipeline/wallet-connect`) BEFORE the existing #829 DB
 * review call (`useReviewSubmission`, `POST .../review {decision:"Approved"}`):
 *   1. `useDrawLoan().mutateAsync({ loanData })` — build -> simulate (the
 *      "verify the loan" step) -> wallet signature -> submit -> poll to a
 *      terminal status.
 *   2. Only once that resolves does `useReviewSubmission` fire.
 *
 * A wallet rejection, a failed simulate/send/poll, or an unconfigured
 * registry/disconnected-wallet guard (see `useDrawLoan`) all reject step 1 —
 * the review call is skipped entirely, the submission stays `InReview`, and
 * `errorMessage` surfaces a mapped, retryable message. **No signature is
 * ever requested when the simulate step fails.**
 *
 * No-double-mint guard: an already-`Approved` submission's `approve()` is a
 * no-op (defensive — the InReview-only footer shouldn't normally allow this
 * call, but guards a stale render/race).
 *
 * ## Idempotency guard — re-click after a mint-succeeded/review-failed retry
 *
 * `useDrawLoan`'s underlying `useMutation` retains its `isSuccess`/`data`
 * state for as long as this hook instance (keyed to one submission `id`,
 * `useOriginationReview(id)`) stays mounted — an in-session "minted" marker
 * for that submission. If the mint (step 1) succeeds but the review call
 * (step 2) then fails, re-clicking Approve checks that marker FIRST: when
 * `drawLoanMutation.isSuccess` is already true for this submission, `approve()`
 * skips step 1 entirely and re-fires ONLY the review call — no second
 * on-chain mint is ever attempted on retry. The pre-submit `simulateTransaction`
 * inside `drawLoan` remains a backstop for the (non-retry) first attempt.
 * **Accepted residual:** a hard page reload between mint-success and
 * finalize-failure loses this in-memory marker (React Query cache is not
 * persisted across reloads) — a subsequent Approve would attempt another
 * on-chain mint. No backend reconciliation exists to close this gap; it is a
 * deliberately accepted bound (issue #831), not a deferred follow-up.
 *
 * **Known limitation (issue #831 Open Question 4, accepted scope):** if the
 * mint succeeds but the subsequent review call fails, the loan is minted
 * on-chain while the DB submission stays `InReview` — a distinct message
 * warns against blindly retrying (a retry would attempt another on-chain
 * mint). Robust reconciliation (the worker already indexes `loan_drawn`) is
 * deferred to a follow-up backend issue — see
 * `docs/exec-plans/tech-debt-tracker.md`.
 *
 * Error copy (issue body, `packages/api/src/routes/loan_book.rs`
 * `review_submission` contract):
 *   - `409` — the submission was already reviewed (race with another
 *     trustee, or a stale page) → "already reviewed, refresh".
 *   - `403` — caller authenticated but lacks the `trustee` role → "not
 *     authorized".
 *   - `401` (`ApiUnauthorizedError`) — missing/invalid/expired session.
 *   - `400` — a validation guard tripped (should not happen given
 *     client-side validation) → surface the backend message.
 *   - anything else — generic fallback, backend message appended when
 *     present.
 */
import { useState } from "react";
import { useReviewSubmission } from "@/api/useReviewSubmission";
import { useDrawLoan, type DrawLoanStage } from "@/api/useDrawLoan";
import { useLoanSubmissions } from "@/api/useLoanSubmissions";
import { ApiError, ApiUnauthorizedError } from "@/api/client";

export interface UseOriginationReviewResult {
  /** Fires the chain-first Approve flow (mint, then review) — no-op if already Approved. */
  approve: () => void;
  /** Opens the reason dialog. */
  openReject: () => void;
  /** Closes the reject-reason dialog without submitting. */
  cancelReject: () => void;
  /** Fires the Reject mutation with the given (already-trimmed) reason. */
  submitReject: (reason: string) => void;
  /** True while the mint, the review call, or Reject is in flight. */
  isPending: boolean;
  /**
   * Progress label for the Approve button while minting (issue #831 Open
   * Question 5: "Waiting for wallet signature…" -> "Submitting on-chain…" ->
   * "Confirming…" -> "Finalizing approval…"). `null` when not minting.
   */
  mintingLabel: string | null;
  /** User-facing error copy, mapped from the last failed step, or `null`. */
  errorMessage: string | null;
  /** Whether the reject-reason dialog is open. */
  rejectOpen: boolean;
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
  const [rejectOpen, setRejectOpen] = useState(false);
  const submissionId = Number(id);

  // Shares the `["loan-submissions", ...]` query cache with
  // `useOriginationDetail` (same default — no `status` filter) so this
  // never triggers a second network fetch.
  const { data: submissions } = useLoanSubmissions();
  const submission = submissions?.find((s) => s.id === submissionId);

  function approve() {
    if (!submission) return;
    // No-double-mint guard (issue #831 Open Question 4): an already-Approved
    // submission needs no further on-chain action.
    if (submission.status === "Approved") return;

    // Idempotency guard (issue #831): if the mint already succeeded in this
    // session (e.g. a prior Approve click minted on-chain but the review call
    // then failed), the "minted" marker is `drawLoanMutation.isSuccess` —
    // skip step 1 (mint) entirely and retry ONLY step 2 (finalize). Never
    // re-invoke `drawLoan` once it has already succeeded for this submission.
    if (drawLoanMutation.isSuccess) {
      reviewMutation.mutate({ id: submissionId, decision: "Approved" });
      return;
    }

    const loanData = submission.loan_data;
    void (async () => {
      try {
        await drawLoanMutation.mutateAsync({ loanData });
      } catch {
        // Mint failed / wallet rejected — stay InReview, no review call.
        // `drawLoanMutation.error` already carries the mapped detail.
        return;
      }
      reviewMutation.mutate({ id: submissionId, decision: "Approved" });
    })();
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
    openReject,
    cancelReject,
    submitReject,
    isPending: drawLoanMutation.isPending || reviewMutation.isPending,
    mintingLabel,
    errorMessage,
    rejectOpen,
  };
}
