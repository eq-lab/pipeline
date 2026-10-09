// spec: docs/frontend/trustee-flows.md#lp-counterparties
import { Button, InlineError } from "@pipeline/ui";
import {
  DETAIL_SECONDARY_BUTTON_CLASS,
  detailSecondaryButtonStyle,
} from "@/components/detail/detailTokens";
import type { LpReviewAction } from "./-useLpCounterpartyDetail";
import { useLpReviewDialog } from "./-useLpReviewDialog";

const copy = {
  Verified: {
    title: "Verify document",
    description:
      "Confirm that you have reviewed this document and verified it.",
    submit: "Verify document",
  },
  Rejected: {
    title: "Reject document",
    description:
      "Give the LP a reason so they can replace this document when changes are requested.",
    submit: "Reject document",
  },
  Passed: {
    title: "Confirm KYB passed",
    description:
      "Confirm that the verified document set is sufficient to approve this account.",
    submit: "Confirm KYB passed",
  },
  ChangesRequested: {
    title: "Request changes",
    description:
      "The LP profile and unverified documents reopen for correction and resubmission.",
    submit: "Request changes",
  },
  Failed: {
    title: "Reject account",
    description:
      "This refusal is permanent. The LP record will be frozen and the owner's account suspended. The API cannot reverse this decision.",
    submit: "Reject account",
  },
};

export interface LpReviewDialogProps {
  action: LpReviewAction;
  legalName: string;
  reason: string;
  onReasonChange: (reason: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
  busy: boolean;
  eligible: boolean;
  validationError: string | null;
  error: { message: string; details: string } | null;
}

export function LpReviewDialog({
  action,
  legalName,
  reason,
  onReasonChange,
  onCancel,
  onSubmit,
  busy,
  eligible,
  validationError,
  error,
}: LpReviewDialogProps) {
  const dialogRef = useLpReviewDialog(onCancel, busy);
  return (
    <div
      className="bg-pipeline-ink/40 fixed inset-0 z-50 flex items-center justify-center px-4"
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lp-review-title"
        aria-describedby="lp-review-description"
        tabIndex={-1}
        className="rounded-pipeline-card-sm bg-pipeline-surface flex max-h-[90vh] w-full max-w-[640px] flex-col gap-4 overflow-y-auto p-7 shadow-xl outline-none"
        onClick={(event) => event.stopPropagation()}
      >
        <h2
          id="lp-review-title"
          className="font-display text-[26px] leading-[36px]"
        >
          {copy[action.decision].title} — {action.filename ?? legalName}
        </h2>
        <p
          id="lp-review-description"
          className="text-pipeline-ink-muted text-sm"
        >
          {copy[action.decision].description}
        </p>
        {action.decision !== "Verified" && (
          <label
            className="flex flex-col gap-2 text-sm"
            htmlFor="lp-review-reason"
          >
            {action.decision === "Rejected"
              ? "Reason (required)"
              : "Reason (optional)"}
            <textarea
              id="lp-review-reason"
              value={reason}
              onChange={(event) => onReasonChange(event.target.value)}
              disabled={busy}
              rows={3}
              aria-invalid={Boolean(validationError)}
              aria-describedby={
                validationError ? "lp-review-validation" : undefined
              }
              className="rounded-pipeline-card border-pipeline-line bg-pipeline-surface text-pipeline-ink focus:border-pipeline-brand w-full border p-3 focus:outline-none disabled:opacity-50"
            />
          </label>
        )}
        {validationError && (
          <p
            id="lp-review-validation"
            role="alert"
            className="text-pipeline-negative-strong text-sm"
          >
            {validationError}
          </p>
        )}
        {!eligible && (
          <p role="status" className="text-pipeline-negative-strong text-sm">
            This decision is no longer available. Close this dialog and refresh
            the account.
          </p>
        )}
        {error && (
          <InlineError message={error.message} details={error.details} />
        )}
        <div className="flex flex-wrap justify-end gap-3">
          <Button
            variant="secondary"
            size="m"
            className={DETAIL_SECONDARY_BUTTON_CLASS}
            style={detailSecondaryButtonStyle()}
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            variant="primary-blue"
            size="m"
            disabled={!eligible || Boolean(validationError) || busy}
            onClick={onSubmit}
          >
            {busy ? "Submitting…" : copy[action.decision].submit}
          </Button>
        </div>
      </div>
    </div>
  );
}
