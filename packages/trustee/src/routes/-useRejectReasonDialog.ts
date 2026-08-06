/**
 * Validation + local text state for the reject-reason / request-changes
 * dialogs. Co-located per `docs/FRONTEND.md` rule 2 (logic out of the
 * `.tsx`) — the dialog components stay pure render functions.
 *
 * spec: docs/frontend/trustee-flows.md#reason-dialog-shell--validation
 * (the 5-character validation rule).
 */
import { useState } from "react";

const MIN_REASON_LENGTH = 5;

export interface UseRejectReasonDialogResult {
  /** Raw (untrimmed) textarea value — bind directly to the `<textarea>`. */
  value: string;
  setValue: (value: string) => void;
  /** `true` once `value.trim().length >= 5`. */
  isValid: boolean;
  /** Inline validation message, or `null` when valid or untouched. */
  validationError: string | null;
  /** The trimmed reason — only meaningful when `isValid` is `true`. */
  trimmedValue: string;
  /** Resets the textarea back to empty (call on dialog close/cancel). */
  reset: () => void;
}

/**
 * @param touched  When `false` (the default, untouched state), no
 *   validation error is shown even for an empty value — only once the user
 *   has interacted, avoiding an error on first render.
 */
export function useRejectReasonDialog(): UseRejectReasonDialogResult {
  const [value, setValueState] = useState("");
  const [touched, setTouched] = useState(false);

  const trimmedValue = value.trim();
  const isValid = trimmedValue.length >= MIN_REASON_LENGTH;

  function setValue(next: string) {
    setTouched(true);
    setValueState(next);
  }

  function reset() {
    setValueState("");
    setTouched(false);
  }

  const validationError =
    touched && !isValid
      ? `Reason must be at least ${MIN_REASON_LENGTH} characters.`
      : null;

  return { value, setValue, isValid, validationError, trimmedValue, reset };
}
