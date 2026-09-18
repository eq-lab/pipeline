// spec: docs/frontend/ui-components.md#otpinput
import { useState } from "react";

export interface UseOtpInputResult {
  focused: boolean;
  onFocus: () => void;
  onBlur: () => void;
  sanitize: (raw: string, length: number) => string;
}

export function useOtpInput(): UseOtpInputResult {
  const [focused, setFocused] = useState(false);

  return {
    focused,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    sanitize: (raw, length) => raw.replace(/\D/g, "").slice(0, length),
  };
}
