import { useCallback, useEffect, useRef } from "react";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";

/**
 * useErrorDetailsDialog — co-located hook for `ErrorDetailsDialog`.
 * spec: docs/frontend/error-handling.md
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

  useEffect(() => {
    if (open) closeButtonRef.current?.focus();
  }, [open]);

  // Capture-phase + stopImmediatePropagation so this dialog consumes Escape
  // before a parent dialog's bubble-phase listener when nested — see
  // docs/frontend/error-handling.md#nested-dialogs-1037.
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

  const { copied, copy: copyText } = useCopyToClipboard();
  const copy = useCallback(() => {
    void copyText(details);
  }, [copyText, details]);

  return { closeButtonRef, copied: open && copied, copy };
}
