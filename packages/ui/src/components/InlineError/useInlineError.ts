import { useState, useCallback } from "react";

/**
 * Co-located hook for `InlineError` (`docs/FRONTEND.md` rule 2) — owns the
 * paired `ErrorDetailsDialog`'s open state so every adoption site gets the
 * disclosure behaviour for free.
 */
export interface UseInlineErrorResult {
  open: boolean;
  openDialog: () => void;
  closeDialog: () => void;
}

export function useInlineError(): UseInlineErrorResult {
  const [open, setOpen] = useState(false);
  const openDialog = useCallback(() => setOpen(true), []);
  const closeDialog = useCallback(() => setOpen(false), []);
  return { open, openDialog, closeDialog };
}
