// spec: docs/frontend/bank-transfers.md#fundingdetailsmodal
import { useEffect } from "react";

export interface UseFundingDetailsModalOptions {
  open: boolean;
  onDismiss: () => void;
}

export function useFundingDetailsModal({
  open,
  onDismiss,
}: UseFundingDetailsModalOptions): void {
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onDismiss();
      }
    }
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [open, onDismiss]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);
}
