// spec: docs/frontend/auth-components.md#forgotpasswordmodal
import { useEffect, useState } from "react";
import {
  EMAIL_PATTERN,
  EMAIL_ERROR_MESSAGE,
} from "@/components/useAuthCredentialsForm";

export interface UseForgotPasswordFormOptions {
  open: boolean;
  onSubmit?: (payload: { email: string }) => void | Promise<void>;
}

export interface UseForgotPasswordFormResult {
  email: string;
  setEmail: (next: string) => void;
  isValid: boolean;
  isSubmitting: boolean;
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
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setEmail("");
      setEmailTouched(false);
      setIsSubmitting(false);
    }
  }, [open]);

  const isValid = email !== "" && EMAIL_PATTERN.test(email);

  const showEmailError = emailTouched && email !== "" && !isValid;

  function handleEmailBlur() {
    setEmailTouched(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid || isSubmitting) return;

    const result = onSubmit?.({ email });
    if (result && typeof result.then === "function") {
      setIsSubmitting(true);
      result.catch(() => {}).finally(() => setIsSubmitting(false));
    }
  }

  return {
    email,
    setEmail,
    isValid,
    isSubmitting,
    emailError: showEmailError ? EMAIL_ERROR_MESSAGE : undefined,
    handleEmailBlur,
    handleSubmit,
  };
}
