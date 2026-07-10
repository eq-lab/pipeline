/**
 * Page orchestration hook for the Origination details page's Approve/Reject
 * controls (issue #829). Co-located with the route per `docs/FRONTEND.md`
 * rule 2 — `origination.$id.tsx` stays JSX-only; this hook composes
 * `useReviewSubmission`, owns the reject-dialog open/close state, and maps
 * the mutation's thrown error to user-facing copy.
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
import { ApiError, ApiUnauthorizedError } from "@/api/client";

export interface UseOriginationReviewResult {
  /** Fires the Approve mutation immediately — no reason. */
  approve: () => void;
  /** Opens the reject-reason dialog. */
  openReject: () => void;
  /** Closes the reject-reason dialog without submitting. */
  cancelReject: () => void;
  /** Fires the Reject mutation with the given (already-trimmed) reason. */
  submitReject: (reason: string) => void;
  /** True while either Approve or Reject is in flight. */
  isPending: boolean;
  /** User-facing error copy, mapped from the last failed mutation, or `null`. */
  errorMessage: string | null;
  /** Whether the reject-reason dialog is open. */
  rejectOpen: boolean;
}

/** Maps a thrown mutation error to user-facing copy. `null` when there is no error. */
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

export function useOriginationReview(id: string): UseOriginationReviewResult {
  const mutation = useReviewSubmission();
  const [rejectOpen, setRejectOpen] = useState(false);
  const submissionId = Number(id);

  function approve() {
    mutation.mutate({ id: submissionId, decision: "Approved" });
  }

  function openReject() {
    mutation.reset();
    setRejectOpen(true);
  }

  function cancelReject() {
    setRejectOpen(false);
    mutation.reset();
  }

  function submitReject(reason: string) {
    mutation.mutate(
      { id: submissionId, decision: "Rejected", reason },
      { onSuccess: () => setRejectOpen(false) },
    );
  }

  return {
    approve,
    openReject,
    cancelReject,
    submitReject,
    isPending: mutation.isPending,
    errorMessage: mapReviewError(mutation.error),
    rejectOpen,
  };
}
