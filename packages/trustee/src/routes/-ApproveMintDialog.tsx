/**
 * Approve & mint confirmation dialog (issue #838, Figma node `4116:13943`) —
 * opened by the "Approve" control on the Origination details page
 * (`origination.$id.tsx`). Mirrors `-RejectReasonDialog.tsx`'s shell/
 * accessibility contract, re-skinned to this frame: `role="dialog"`,
 * `aria-modal="true"`, `aria-labelledby` on the title, Escape-to-close,
 * backdrop-click-cancels, initial focus on the Cancel button (no text input
 * to focus here).
 *
 * ## Confirm gate (issue #838 Open Question 1 — resolved)
 *
 * Before this issue, clicking Approve fired the #831 chain-first mint→review
 * orchestration immediately. This dialog introduces a pre-mint confirmation
 * gate: Approve now OPENS this dialog (see `-useOriginationReview.ts`'s
 * `openApprove`), and the orchestration only runs when the trustee clicks
 * "Mint loan" (`onConfirm`, wired to the existing `approve()`). The
 * orchestration itself — chain-first ordering, idempotency guard,
 * wallet-rejection/tx-failure error mapping — is UNCHANGED by this issue.
 *
 * ## Transaction preview
 *
 * The dark code block renders `preview` (computed by
 * `-origination-detail.ts`'s `mapTransactionPreview`, from the real
 * `loan_data` payload — the same one sent to `useDrawLoan`). The Figma
 * frame's four green mint-invariant checklist rows ("senior + equity ==
 * facility size", etc.) are deliberately OMITTED — no backend field backs
 * them, and this project never fabricates "green" confidence signals.
 *
 * ## Progress / success / error (issue #838 Open Question 3 — resolved)
 *
 * The frame depicts only the confirm state; progress/error/success carry
 * over the pre-existing behavior verbatim, now surfaced inside the dialog
 * instead of via a page-level button-label swap:
 *   - `mintingLabel` swaps the "Mint loan" button's text through the mint's
 *     stages ("Waiting for wallet signature…" → "Submitting on-chain…" →
 *     "Confirming…" → "Finalizing approval…").
 *   - `errorMessage` renders inline inside the dialog (mirrors
 *     `RejectReasonDialog`'s error `<p>`) — retryable, the submission stays
 *     InReview.
 *   - Success closes the dialog (handled by the caller via `approveOpen`
 *     flipping false on review success) — there is no dedicated in-dialog
 *     success state; the page's footer flips to the Approved banner.
 *
 * Cancel/Escape/backdrop-click are disabled while `isSubmitting` — once the
 * trustee clicks "Mint loan" the on-chain sequence is in flight and cannot
 * be un-shown; this is a deliberate stricter contract than
 * `RejectReasonDialog` (whose Cancel stays enabled during submission, since
 * a review-only mutation has no on-chain side effect to lose visibility
 * into). This also protects `-useOriginationReview.ts`'s idempotency
 * guard — the dialog cannot be dismissed mid-mint in a way that would
 * confuse a subsequent Approve click.
 */
import { useEffect, useRef } from "react";
import type { TransactionPreviewDisplay } from "./-origination-detail";

export interface ApproveMintDialogProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  isSubmitting: boolean;
  /** Progress label while minting (issue #831), or `null` when not minting. */
  mintingLabel: string | null;
  errorMessage: string | null;
  preview: TransactionPreviewDisplay;
}

const CODE_FONT =
  "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

export function ApproveMintDialog({
  open,
  onCancel,
  onConfirm,
  isSubmitting,
  mintingLabel,
  errorMessage,
  preview,
}: ApproveMintDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus the Cancel button whenever the dialog transitions to open — there
  // is no text input in this dialog to focus instead (mirrors
  // `RejectReasonDialog`'s open-transition focus behavior).
  useEffect(() => {
    if (open) {
      cancelRef.current?.focus();
    }
  }, [open]);

  // Escape closes the dialog, UNLESS a mint is in flight — see the module
  // docblock for why Cancel/Escape/backdrop are locked while `isSubmitting`.
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !isSubmitting) onCancel();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, isSubmitting, onCancel]);

  if (!open) return null;

  function handleBackdropClick() {
    if (isSubmitting) return;
    onCancel();
  }

  return (
    <div
      data-testid="approve-mint-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(38,37,36,0.4)]"
      onClick={handleBackdropClick}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="approve-mint-title"
        data-testid="approve-mint-dialog"
        className="flex w-[640px] max-w-[calc(100vw-32px)] flex-col gap-[4px] rounded-[6px] bg-white px-[30px] py-[28px] shadow-[0px_10px_40px_0px_rgba(0,0,40,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="approve-mint-title"
          className="font-[family-name:var(--font-display)] text-[26px] leading-[36.4px] text-[#262524]"
        >
          Approve & draw loan
        </h2>
        <p className="font-[family-name:var(--font-body)] text-[14px] leading-[19.6px] text-[rgba(56,55,53,0.6)]">
          Transaction preview — sent from your Trustee key.
        </p>

        <div
          data-testid="approve-mint-preview"
          className="w-full overflow-x-auto rounded-[4px] bg-[#000040] px-[16px] pt-[28px] pb-[14px]"
        >
          <div
            style={{ fontFamily: CODE_FONT }}
            className="text-[12.5px] leading-[22.1px] whitespace-pre"
          >
            <p className="m-0">
              <span className="text-[#9fd0ff]">{preview.keyword}</span>
              <span className="text-[#e2e2f5]">(</span>
            </p>
            {preview.rows.map((row, i) => (
              <p className="m-0" key={row.label}>
                <span className="text-[#e2e2f5]">{`  ${row.label}: `}</span>
                <span className="text-[#c8e6a0]">{row.value}</span>
                <span className="text-[#e2e2f5]">
                  {i === preview.rows.length - 1 ? ")" : ","}
                </span>
              </p>
            ))}
          </div>
        </div>

        {errorMessage && (
          <p
            data-testid="approve-mint-error"
            className="pt-[12px] font-[family-name:var(--font-body)] text-[14px] text-[color:var(--color-pipeline-negative)]"
          >
            {errorMessage}
          </p>
        )}

        <div className="flex items-start justify-end gap-[12px] pt-[20px]">
          <button
            ref={cancelRef}
            type="button"
            data-testid="approve-mint-cancel"
            disabled={isSubmitting}
            aria-disabled={isSubmitting}
            onClick={onCancel}
            className="h-[40px] rounded-[4px] border border-solid border-[rgba(56,55,53,0.18)] bg-white px-[17px] font-[family-name:var(--font-body)] text-[16px] text-[#262524] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="approve-mint-confirm"
            disabled={isSubmitting}
            aria-disabled={isSubmitting}
            onClick={onConfirm}
            className="h-[40px] rounded-[4px] bg-[#000080] px-[16px] font-[family-name:var(--font-body)] text-[16px] text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {mintingLabel ?? "Draw loan"}
          </button>
        </div>
      </div>
    </div>
  );
}
