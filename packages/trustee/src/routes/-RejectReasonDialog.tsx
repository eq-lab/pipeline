/**
 * Reject-reason dialog (issue #829) — opened by the "Reject" control on the
 * Origination details page (`origination.$id.tsx`). No Figma reference
 * exists for this dialog; it is a small, accessible modal styled with the
 * same tokens as the rest of the details page (navy `#000080` primary,
 * `rgba(56,55,53,0.18)` borders).
 *
 * Accessibility: `role="dialog"`, `aria-modal="true"`, `aria-labelledby` on
 * the title, closes on Escape and on the Cancel button, initial focus on the
 * textarea, and a backdrop click that closes WITHOUT submitting (mirrors
 * Cancel, never a stray submit).
 *
 * Validation state (trimmed length + inline error) lives in the co-located
 * `-useRejectReasonDialog.ts` hook per `docs/FRONTEND.md` rule 2 — this
 * component is JSX/styling only.
 */
import { useEffect, useRef } from "react";
import { useRejectReasonDialog } from "./-useRejectReasonDialog";

export interface RejectReasonDialogProps {
  open: boolean;
  onCancel: () => void;
  onSubmit: (reason: string) => void;
  isSubmitting: boolean;
  errorMessage: string | null;
}

export function RejectReasonDialog({
  open,
  onCancel,
  onSubmit,
  isSubmitting,
  errorMessage,
}: RejectReasonDialogProps) {
  const { value, setValue, isValid, validationError, trimmedValue, reset } =
    useRejectReasonDialog();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset the reason text whenever the dialog transitions to open, and focus
  // the textarea for immediate typing.
  useEffect(() => {
    if (open) {
      reset();
      textareaRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open transition, not on every reset() identity change
  }, [open]);

  // Escape closes the dialog regardless of which element currently has
  // focus (not just the textarea) — a window-level listener rather than a
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
        className="flex w-[420px] flex-col gap-[16px] rounded-[4px] bg-white p-[24px] shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="reject-reason-title"
          className="font-[family-name:var(--font-display)] text-[20px] leading-[26px] text-[#262524]"
        >
          Reject submission
        </h2>
        <label
          htmlFor="reject-reason-input"
          className="font-[family-name:var(--font-body)] text-[14px] text-[rgba(56,55,53,0.6)]"
        >
          Reason
        </label>
        <textarea
          ref={textareaRef}
          id="reject-reason-input"
          data-testid="reject-reason-input"
          value={value}
          disabled={isSubmitting}
          onChange={(e) => setValue(e.target.value)}
          rows={3}
          className="rounded-[4px] border border-solid border-[rgba(56,55,53,0.18)] p-[10px] font-[family-name:var(--font-body)] text-[15px] text-[#262524]"
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
          <p
            data-testid="reject-reason-error"
            className="font-[family-name:var(--font-body)] text-[13px] text-[color:var(--color-pipeline-negative)]"
          >
            {errorMessage}
          </p>
        )}
        <div className="flex items-center justify-end gap-[10px] pt-[4px]">
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
            className="h-[40px] rounded-[4px] bg-[#000080] px-[17px] font-[family-name:var(--font-body)] text-[16px] text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? "Submitting…" : "Submit"}
          </button>
        </div>
      </div>
    </div>
  );
}
