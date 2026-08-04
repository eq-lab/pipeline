/**
 * Page orchestration hook for the Origination details page's
 * Approve/Reject/Request-changes controls. Co-located with the route per
 * `docs/FRONTEND.md` rule 2 — `origination.$id.tsx` stays JSX-only; this hook
 * owns the reject-dialog, the request-changes-dialog (#1017) AND (as of issue
 * #838) the approve-mint-confirmation-dialog open/close state, and maps
 * mutation errors to user-facing copy. Request changes mirrors Reject: a pure
 * DB review call (`{ decision: "ChangesRequested", reason }`, backend #949) —
 * no on-chain step, non-final (the submission stays open for re-review).
 *
 * ## Approve confirmation gate (issue #838, Figma node `4116:13943`)
 *
 * Before #838, clicking Approve fired `approve()` (below) immediately. #838
 * introduces a pre-mint confirmation dialog (`-ApproveMintDialog.tsx`):
 * `openApprove()` opens it; `approve()` — UNCHANGED — is now invoked only as
 * the dialog's "Mint loan" confirm action; `cancelApprove()` closes it
 * without touching the on-chain mint. This does not alter the #831
 * orchestration itself (still chain-first mint → review, still guarded by
 * the same idempotency check) — it only gates *when* `approve()` fires.
 * `cancelApprove()` deliberately does NOT reset `useDrawLoan`'s mutation once
 * it has already succeeded (`drawLoanMutation.isSuccess`) — doing so would
 * erase the idempotency guard's "already minted this session" marker and
 * risk a second on-chain mint on a subsequent Approve click.
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
    // No-double-mint guard (issue #831 Open Question 4): an already-Approved
    // submission needs no further on-chain action.
    if (submission.status === "Approved") return;

    // Idempotency guard (issue #831): if the mint already succeeded in this
    // session (e.g. a prior Approve click minted on-chain but the review call
    // then failed), the "minted" marker is `drawLoanMutation.isSuccess` —
    // skip step 1 (mint) entirely and retry ONLY step 2 (finalize). Never
    // re-invoke `drawLoan` once it has already succeeded for this submission.
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
        // `drawLoanMutation.error` already carries the mapped detail.
        return;
      }
      fireApprovalReview();
    })();
  }

  // Opens the approve & mint confirmation dialog (issue #838), clearing any
  // stale review error left over from a previous Reject attempt sharing the
  // same `reviewMutation` instance — mirrors `openReject`'s reset below.
  function openApprove() {
    reviewMutation.reset();
    setApproveOpen(true);
  }

  // Closes the approve & mint dialog without minting. Only reachable while
  // NOT submitting (the dialog disables Cancel/Escape/backdrop-close during
  // the mint — see `-ApproveMintDialog.tsx`), so this always represents
  // either a fresh, untouched dialog or one showing a settled error.
  // `drawLoanMutation.reset()` is skipped once it has already succeeded —
  // clearing it would erase the idempotency guard's "already minted this
  // session" marker and risk a second on-chain mint on retry.
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
