/**
 * Reject-reason dialog — opened by the "Reject" control on the Origination
 * details page (`origination.$id.tsx`). Styled with the same tokens as the
 * rest of the details page (navy `#000080` primary,
 * `rgba(56,55,53,0.18)` borders).
 *
 * spec: docs/frontend/trustee-flows.md#reason-dialog-shell--validation
 * (accessibility contract, validation rule, re-skin history).
 */
import { useEffect, useRef } from "react";
import { useRejectReasonDialog } from "./-useRejectReasonDialog";
import { InlineError } from "@pipeline/ui";

export interface RejectReasonDialogProps {
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

export function RejectReasonDialog({
  open,
  originator,
  onCancel,
  onSubmit,
  isSubmitting,
  errorMessage,
  errorDetails,
}: RejectReasonDialogProps) {
  const { value, setValue, isValid, validationError, trimmedValue, reset } =
    useRejectReasonDialog();
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset the reason text whenever the dialog transitions to open, and focus
  // the input for immediate typing.
  useEffect(() => {
    if (open) {
      reset();
      inputRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open transition, not on every reset() identity change
  }, [open]);

  // Escape closes the dialog regardless of which element currently has
  // focus (not just the input) — a window-level listener rather than a
  // per-element `onKeyDown` guards against focus having moved elsewhere.
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
      data-testid="reject-reason-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(38,37,36,0.4)]"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reject-reason-title"
        data-testid="reject-reason-dialog"
        className="flex w-[640px] max-w-[calc(100vw-32px)] flex-col gap-[4px] rounded-[6px] bg-white px-[30px] py-[28px] shadow-[0px_10px_40px_0px_rgba(0,0,40,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="reject-reason-title"
          className="font-[family-name:var(--font-display)] text-[26px] leading-[36.4px] text-[#262524]"
        >
          Reject request — {originator}
        </h2>
        <p className="font-[family-name:var(--font-body)] text-[14px] leading-[19.6px] text-[rgba(56,55,53,0.6)]">
          The request closes and the originator sees your reason.
        </p>
        <label
          htmlFor="reject-reason-input"
          className="pt-[14px] font-[family-name:var(--font-body)] text-[13px] leading-[18.2px] text-[rgba(56,55,53,0.6)]"
        >
          Reason
        </label>
        <input
          ref={inputRef}
          type="text"
          id="reject-reason-input"
          data-testid="reject-reason-input"
          value={value}
          disabled={isSubmitting}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. offtaker price below facility covenant"
          className="w-full rounded-[4px] border border-solid border-[rgba(56,55,53,0.18)] px-[13px] py-[12px] font-[family-name:var(--font-body)] text-[15px] text-[#262524] placeholder:text-[#757575]"
        />
        {validationError && (
          <p
            data-testid="reject-reason-validation-error"
            className="font-[family-name:var(--font-body)] text-[13px] text-[color:var(--color-pipeline-negative)]"
          >
            {validationError}
          </p>
        )}
        {errorMessage && (
          <div data-testid="reject-reason-error">
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
            data-testid="reject-reason-cancel"
            onClick={onCancel}
            className="h-[40px] rounded-[4px] border border-solid border-[rgba(56,55,53,0.18)] bg-white px-[17px] font-[family-name:var(--font-body)] text-[16px] text-[#262524]"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="reject-reason-submit"
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
