// spec: docs/frontend/auth-components.md#resetpasswordmodal
import { useEffect, useState } from "react";
import {
  meetsPasswordPolicy,
  PASSWORD_POLICY_ERROR_MESSAGE,
} from "@/components/useAuthCredentialsForm";

export interface UseResetPasswordFormOptions {
  open: boolean;
  onSubmit?: (payload: { password: string }) => void | Promise<void>;
}

export interface UseResetPasswordFormResult {
  password: string;
  setPassword: (next: string) => void;
  isValid: boolean;
  isSubmitting: boolean;
  passwordError: string | undefined;
  handlePasswordBlur: () => void;
  handleSubmit: (e: React.FormEvent) => void;
}

export function useResetPasswordForm({
  open,
  onSubmit,
}: UseResetPasswordFormOptions): UseResetPasswordFormResult {
  const [password, setPassword] = useState("");
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setPassword("");
      setPasswordTouched(false);
      setSubmitAttempted(false);
      setIsSubmitting(false);
    }
  }, [open]);

  const isValid = meetsPasswordPolicy(password);

  const showPasswordError =
    ((passwordTouched && password !== "") || submitAttempted) && !isValid;

  function handlePasswordBlur() {
    setPasswordTouched(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitAttempted(true);
    if (!isValid || isSubmitting) return;

    const result = onSubmit?.({ password });
    if (result && typeof result.then === "function") {
      setIsSubmitting(true);
      result.catch(() => {}).finally(() => setIsSubmitting(false));
    }
  }

  return {
    password,
    setPassword,
    isValid,
    isSubmitting,
    passwordError: showPasswordError
      ? PASSWORD_POLICY_ERROR_MESSAGE
      : undefined,
    handlePasswordBlur,
    handleSubmit,
  };
}
