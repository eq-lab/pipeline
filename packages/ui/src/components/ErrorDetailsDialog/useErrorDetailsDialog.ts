import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Co-located hook for `ErrorDetailsDialog` (`docs/FRONTEND.md` rule 2: the
 * `.tsx` stays JSX/styling-only; open-state side effects and the clipboard
 * copy live here).
 */
export interface UseErrorDetailsDialogOptions {
  open: boolean;
  /** The raw text copied to the clipboard by the Copy button. */
  details: string;
  onClose: () => void;
}

export interface UseErrorDetailsDialogResult {
  closeButtonRef: React.RefObject<HTMLButtonElement | null>;
  /** True for ~1.5s after a successful copy (label flips to "Copied"). */
  copied: boolean;
  copy: () => void;
}

export function useErrorDetailsDialog({
  open,
  details,
  onClose,
}: UseErrorDetailsDialogOptions): UseErrorDetailsDialogResult {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);

  // Initial focus on the Close button whenever the dialog transitions to open.
  useEffect(() => {
    if (open) closeButtonRef.current?.focus();
  }, [open]);

  // Escape closes the dialog regardless of which element currently has focus
  // — a window-level listener rather than a per-element `onKeyDown` guards
  // against focus having moved elsewhere (e.g. onto the Copy button).
  //
  // Registered in the CAPTURE phase with `stopImmediatePropagation()`: when
  // this dialog is opened from inside another dialog (e.g. a trustee review
  // dialog), that parent dialog's own Escape listener is bubble-phase and
  // registered earlier, so without capture it would fire first and close the
  // parent, unmounting this dialog with it. Capture-phase listeners run
  // before bubble-phase ones for the same event, so the topmost (most
  // recently opened) dialog consumes Escape first. This means any future
  // dialog that wants to nest inside another must stay bubble-phase itself
  // so it doesn't out-race a details dialog nested inside IT.
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [open, onClose]);

  // Reset the "Copied" flag whenever the dialog closes, so it doesn't
  // reappear stale the next time it opens.
  useEffect(() => {
    if (!open) setCopied(false);
  }, [open]);

  // Guarded clipboard write — feature-detects `navigator.clipboard` and
  // silently no-ops on rejection (e.g. non-secure context). Mirrors
  // `useAccountDropdown`'s copy pattern.
  const copy = useCallback(() => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(details).then(
        () => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        },
        () => {
          // Silently no-op if clipboard write fails.
        },
      );
    }
  }, [details]);

  return { closeButtonRef, copied, copy };
}
