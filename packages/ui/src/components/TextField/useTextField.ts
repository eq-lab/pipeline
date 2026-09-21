import { useId, useState } from "react";

// spec: docs/frontend/ui-components.md#textfield
export interface UseTextFieldOptions {
  type: "text" | "email" | "password";
}

export interface UseTextFieldResult {
  inputType: "text" | "email" | "password";
  showPassword: boolean;
  toggleShowPassword: () => void;
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
