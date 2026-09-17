import { useId, useState } from "react";

/**
 * useTextField — co-located hook for `TextField`.
 * spec: docs/frontend/ui-components.md#textfield
 */
export interface UseTextFieldOptions {
  type: "text" | "email" | "password";
}

export interface UseTextFieldResult {
  /** The `<input type>` to render — flips to "text" while a password is shown. */
  inputType: "text" | "email" | "password";
  showPassword: boolean;
  toggleShowPassword: () => void;
  /** Stable id for the error `<p>`, wired via `aria-describedby`. */
  errorId: string;
}

export function useTextField({
  type,
}: UseTextFieldOptions): UseTextFieldResult {
  const [showPassword, setShowPassword] = useState(false);
  const errorId = useId();

  return {
    inputType: type === "password" && showPassword ? "text" : type,
    showPassword,
    toggleShowPassword: () => setShowPassword((prev) => !prev),
    errorId,
  };
}
