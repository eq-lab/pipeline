/**
 * Request-changes reason dialog — opened by the "Request changes" control on
 * the Origination details page (`origination.$id.tsx`). Submits the
 * non-final `ChangesRequested` review decision with the entered reason; the
 * submission stays open for the originator to amend and resubmit.
 *
 * spec: docs/frontend/trustee-flows.md#reason-dialog-shell--validation,
 * docs/frontend/trustee-flows.md#request-changes-1017.
 */
import { useEffect, useRef } from "react";
import { useRejectReasonDialog } from "./-useRejectReasonDialog";
import { InlineError } from "@pipeline/ui";

export interface RequestChangesDialogProps {
  open: boolean;
  /** The originator's display name, interpolated into the dialog title. */
  originator: string;
  onCancel: () => void;
  onSubmit: (reason: string) => void;
  isSubmitting: boolean;
  errorMessage: string | null;
  /** Full raw text behind `errorMessage`, for `InlineError`'s details dialog. */
  errorDetails: string | null;
}

export function RequestChangesDialog({
  open,
  originator,
  onCancel,
  onSubmit,
  isSubmitting,
  errorMessage,
  errorDetails,
}: RequestChangesDialogProps) {
  const { value, setValue, isValid, validationError, trimmedValue, reset } =
    useRejectReasonDialog();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Reset the reason text whenever the dialog transitions to open, and focus
  // the textarea for immediate typing.
  useEffect(() => {
    if (open) {
      reset();
      inputRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open transition, not on every reset() identity change
  }, [open]);

  // Escape closes the dialog regardless of which element currently has
  // focus — a window-level listener rather than a per-element `onKeyDown`
  // guards against focus having moved elsewhere.
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  function handleSubmit() {
    if (!isValid || isSubmitting) return;
    onSubmit(trimmedValue);
  }

  return (
    <div
      data-testid="request-changes-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(38,37,36,0.4)]"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="request-changes-title"
        data-testid="request-changes-dialog"
        className="flex w-[640px] max-w-[calc(100vw-32px)] flex-col gap-[4px] rounded-[6px] bg-white px-[30px] py-[28px] shadow-[0px_10px_40px_0px_rgba(0,0,40,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="request-changes-title"
          className="font-[family-name:var(--font-display)] text-[26px] leading-[36.4px] text-[#262524]"
        >
          Request changes — {originator}
        </h2>
        <p className="font-[family-name:var(--font-body)] text-[14px] leading-[19.6px] text-[rgba(56,55,53,0.6)]">
          The request returns to the originator with your reason; they can amend
          and resubmit.
        </p>
        <label
          htmlFor="request-changes-input"
          className="pt-[14px] font-[family-name:var(--font-body)] text-[13px] leading-[18.2px] text-[rgba(56,55,53,0.6)]"
        >
          Reason
        </label>
        <textarea
          ref={inputRef}
          id="request-changes-input"
          data-testid="request-changes-input"
          rows={3}
          value={value}
          disabled={isSubmitting}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. assay certificate missing the moisture figure"
          className="w-full resize-y rounded-[4px] border border-solid border-[rgba(56,55,53,0.18)] px-[13px] py-[12px] font-[family-name:var(--font-body)] text-[15px] text-[#262524] placeholder:text-[#757575]"
        />
        {validationError && (
          <p
            data-testid="request-changes-validation-error"
            className="font-[family-name:var(--font-body)] text-[13px] text-[color:var(--color-pipeline-negative)]"
          >
            {validationError}
          </p>
        )}
        {errorMessage && (
          <div data-testid="request-changes-error">
            <InlineError
              message={errorMessage}
              details={errorDetails ?? undefined}
              className="block text-[13px]"
            />
          </div>
        )}
        <div className="flex items-start justify-end gap-[12px] pt-[20px]">
          <button
            type="button"
            data-testid="request-changes-cancel"
            onClick={onCancel}
            className="h-[40px] rounded-[4px] border border-solid border-[rgba(56,55,53,0.18)] bg-white px-[17px] font-[family-name:var(--font-body)] text-[16px] text-[#262524]"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="request-changes-submit"
            disabled={!isValid || isSubmitting}
            aria-disabled={!isValid || isSubmitting}
            onClick={handleSubmit}
            className="h-[40px] rounded-[4px] bg-[#000080] px-[16px] font-[family-name:var(--font-body)] text-[16px] text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? "Submitting…" : "Send to originator"}
          </button>
        </div>
      </div>
    </div>
  );
}
