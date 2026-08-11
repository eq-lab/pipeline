import { useCallback, useEffect, useRef, useState } from "react";

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
  const [copied, setCopied] = useState(false);

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

  // Reset the "Copied" flag on close so it doesn't reappear stale on reopen.
  useEffect(() => {
    if (!open) setCopied(false);
  }, [open]);

  // Feature-detect `navigator.clipboard`; silently no-op on rejection
  // (e.g. non-secure context).
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
