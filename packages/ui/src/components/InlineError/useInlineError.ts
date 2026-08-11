import { useState, useCallback } from "react";

/**
 * useInlineError — co-located hook for `InlineError`; owns the paired
 * `ErrorDetailsDialog`'s open state. spec: docs/frontend/error-handling.md
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
