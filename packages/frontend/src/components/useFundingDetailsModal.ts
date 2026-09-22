// spec: docs/frontend/bank-transfers.md#fundingdetailsmodal
import { useCallback, useEffect, useState } from "react";
import { formatFundingDetailsForCopy } from "./fundingDetails";
import type { FundingDetailRow } from "./fundingDetails";

export interface UseFundingDetailsModalOptions {
  open: boolean;
  rows: ReadonlyArray<FundingDetailRow>;
  onDismiss: () => void;
}

export interface UseFundingDetailsModalResult {
  copied: boolean;
  copy: () => void;
}

export function useFundingDetailsModal({
  open,
  rows,
  onDismiss,
}: UseFundingDetailsModalOptions): UseFundingDetailsModalResult {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) setCopied(false);
  }, [open]);

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

  const copy = useCallback(() => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(formatFundingDetailsForCopy(rows)).then(
        () => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        },
        () => {},
      );
    }
  }, [rows]);

  return { copied, copy };
}
