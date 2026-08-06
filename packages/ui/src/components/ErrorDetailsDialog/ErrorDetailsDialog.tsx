import { Button } from "../Button";
import { useErrorDetailsDialog } from "./useErrorDetailsDialog";

/**
 * ErrorDetailsDialog — shared modal that shows the full raw text behind a
 * failed action (e.g. a Soroban simulation error), with a copy-to-clipboard
 * button. Paired with `InlineError`, which owns this dialog's open state at
 * each adoption site. spec: docs/frontend/error-handling.md
 *
 * Shell/a11y pattern copied from the `NetworkSwitchDialog` idiom (#1032) /
 * `-RejectReasonDialog.tsx` (informational 440px proportions, not the
 * 640px form variant): fixed backdrop, `role="dialog"` + `aria-modal` +
 * `aria-labelledby`, Escape closes, backdrop click closes, panel click does
 * not, initial focus on Close.
 */
export interface ErrorDetailsDialogProps {
  open: boolean;
  /** Dialog heading. Defaults to "Error details". */
  title?: string;
  /** The short human line, echoed above the raw block for context. */
  summary?: string;
  /** The full raw error text rendered verbatim in the <pre>. */
  details: string;
  onClose: () => void;
}

export function ErrorDetailsDialog({
  open,
  title = "Error details",
  summary,
  details,
  onClose,
}: ErrorDetailsDialogProps) {
  const { closeButtonRef, copied, copy } = useErrorDetailsDialog({
    open,
    details,
    onClose,
  });

  if (!open) return null;

  return (
    <div
      data-testid="error-details-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(38,37,36,0.4)]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="error-details-title"
        data-testid="error-details-dialog"
        className="flex w-[440px] max-w-[calc(100vw-32px)] flex-col gap-3 rounded-[6px] bg-white px-7 py-6 shadow-[0px_10px_40px_0px_rgba(0,0,40,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="error-details-title"
          className="font-[family-name:var(--font-display)] text-[20px] leading-[28px] text-[color:var(--color-pipeline-ink)]"
        >
          {title}
        </h2>
        {summary && (
          <p className="font-[family-name:var(--font-body)] text-[14px] leading-[19.6px] text-[color:var(--color-pipeline-ink-muted)]">
            {summary}
          </p>
        )}
        <pre
          data-testid="error-details-raw"
          className="max-h-[280px] overflow-auto rounded-[4px] bg-[color:var(--color-pipeline-surface-muted)] p-3 font-mono text-[12px] leading-[18px] break-words whitespace-pre-wrap text-[color:var(--color-pipeline-ink)]"
        >
          {details}
        </pre>
        <div className="flex items-center justify-end gap-3 pt-1">
          <Button
            type="button"
            variant="secondary"
            data-testid="error-details-copy"
            onClick={copy}
            className="!h-10"
          >
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button
            ref={closeButtonRef}
            type="button"
            variant="primary-dark"
            data-testid="error-details-close"
            onClick={onClose}
            className="!h-10"
          >
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ErrorDetailsDialog;
