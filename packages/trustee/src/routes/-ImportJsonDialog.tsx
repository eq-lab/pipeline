/**
 * Import-from-JSON dialog — opened by the "Import from JSON" control on the
 * Submit-a-loan page (`origination.new.tsx`, #1100). A plain textarea for
 * pasting a `SubmitLoanRequest`-shaped payload; parse failures render inline
 * and keep the dialog open, a successful import closes it (the page shows the
 * missing-fields warning). Shell, tokens, and keyboard contract mirror
 * `-RejectReasonDialog.tsx`.
 *
 * spec: docs/frontend/trustee-flows.md#submit-a-loan-originationnew-1100.
 */
import { useEffect, useRef, useState } from "react";

export interface ImportJsonDialogProps {
  open: boolean;
  onCancel: () => void;
  /** Returns an error string to display (dialog stays open), or `null` on success. */
  onImport: (text: string) => string | null;
}

export function ImportJsonDialog({
  open,
  onCancel,
  onImport,
}: ImportJsonDialogProps) {
  const [text, setText] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setText("");
      setParseError(null);
      inputRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  function handleImport() {
    const error = onImport(text);
    setParseError(error);
  }

  return (
    <div
      data-testid="import-json-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(38,37,36,0.4)]"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-json-title"
        data-testid="import-json-dialog"
        className="flex w-[640px] max-w-[calc(100vw-32px)] flex-col gap-[4px] rounded-[6px] bg-white px-[30px] py-[28px] shadow-[0px_10px_40px_0px_rgba(0,0,40,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="import-json-title"
          className="font-[family-name:var(--font-display)] text-[26px] leading-[36.4px] text-[#262524]"
        >
          Import from JSON
        </h2>
        <p className="font-[family-name:var(--font-body)] text-[14px] leading-[19.6px] text-[rgba(56,55,53,0.6)]">
          Paste a submission payload. Fields found in the JSON fill the form;
          anything missing is listed afterwards so you can complete it by hand.
        </p>
        <textarea
          ref={inputRef}
          id="import-json-input"
          data-testid="import-json-input"
          value={text}
          rows={14}
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          placeholder='{ "to": "G…", "metadata_uri": "…", … }'
          className="mt-[14px] w-full resize-y rounded-[4px] border border-solid border-[rgba(56,55,53,0.18)] px-[13px] py-[12px] font-mono text-[13px] leading-[18.2px] text-[#262524] placeholder:text-[#757575]"
        />
        {parseError && (
          <p
            data-testid="import-json-error"
            className="font-[family-name:var(--font-body)] text-[13px] text-[color:var(--color-pipeline-negative)]"
          >
            {parseError}
          </p>
        )}
        <div className="flex items-start justify-end gap-[12px] pt-[20px]">
          <button
            type="button"
            data-testid="import-json-cancel"
            onClick={onCancel}
            className="h-[40px] rounded-[4px] border border-solid border-[rgba(56,55,53,0.18)] bg-white px-[17px] font-[family-name:var(--font-body)] text-[16px] text-[#262524]"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="import-json-submit"
            disabled={text.trim() === ""}
            onClick={handleImport}
            className="h-[40px] rounded-[4px] bg-[#000080] px-[16px] font-[family-name:var(--font-body)] text-[16px] text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Import
          </button>
        </div>
      </div>
    </div>
  );
}
