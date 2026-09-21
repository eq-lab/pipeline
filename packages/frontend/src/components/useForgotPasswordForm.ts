// spec: docs/frontend/auth-components.md#forgotpasswordmodal (validation rules,
// reuses EMAIL_PATTERN / EMAIL_ERROR_MESSAGE from useAuthCredentialsForm).
import { useEffect, useState } from "react";
import {
  EMAIL_PATTERN,
  EMAIL_ERROR_MESSAGE,
} from "@/components/useAuthCredentialsForm";

export interface UseForgotPasswordFormOptions {
  open: boolean;
  onSubmit?: (payload: { email: string }) => void;
}

export interface UseForgotPasswordFormResult {
  email: string;
  setEmail: (next: string) => void;
  isValid: boolean;
  emailError: string | undefined;
  handleEmailBlur: () => void;
  handleSubmit: (e: React.FormEvent) => void;
}

export function useForgotPasswordForm({
  open,
  onSubmit,
}: UseForgotPasswordFormOptions): UseForgotPasswordFormResult {
  const [email, setEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  useEffect(() => {
    if (open) {
      setEmail("");
      setEmailTouched(false);
      setSubmitAttempted(false);
    }
  }, [open]);

  const isValid = email !== "" && EMAIL_PATTERN.test(email);

  const showEmailError =
    (emailTouched || submitAttempted) && email !== "" && !isValid;

  function handleEmailBlur() {
    setEmailTouched(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitAttempted(true);
    if (isValid) {
      onSubmit?.({ email });
    }
  }

  return {
    email,
    setEmail,
    isValid,
    emailError: showEmailError ? EMAIL_ERROR_MESSAGE : undefined,
    handleEmailBlur,
    handleSubmit,
  };
}
