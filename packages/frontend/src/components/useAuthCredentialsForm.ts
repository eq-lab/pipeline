// spec: docs/frontend/auth-components.md#signinmodal (validation rules, Figma
// node 6486:81595 error copy) — shared by SignInModal and CreateAccountModal.
import { useEffect, useState } from "react";

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const EMAIL_ERROR_MESSAGE = "Enter the correct email address";
export const PASSWORD_ERROR_MESSAGE = "Enter the correct password";

export interface UseAuthCredentialsFormOptions {
  open: boolean;
  onSubmit?: (credentials: { email: string; password: string }) => void;
}

export interface UseAuthCredentialsFormResult {
  email: string;
  setEmail: (next: string) => void;
  password: string;
  setPassword: (next: string) => void;
  isValid: boolean;
  emailError: string | undefined;
  passwordError: string | undefined;
  handleEmailBlur: () => void;
  handleSubmit: (e: React.FormEvent) => void;
}

export function useAuthCredentialsForm({
  open,
  onSubmit,
}: UseAuthCredentialsFormOptions): UseAuthCredentialsFormResult {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  useEffect(() => {
    if (open) {
      setEmail("");
      setPassword("");
      setEmailTouched(false);
      setSubmitAttempted(false);
    }
  }, [open]);

  const isEmailWellFormed = email !== "" && EMAIL_PATTERN.test(email);
  const isValid = isEmailWellFormed && password !== "";

  const showEmailError =
    (emailTouched || submitAttempted) && email !== "" && !isEmailWellFormed;
  const showPasswordError = submitAttempted && password === "";

  function handleEmailBlur() {
    setEmailTouched(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitAttempted(true);
    if (isValid) {
      onSubmit?.({ email, password });
    }
  }

  return {
    email,
    setEmail,
    password,
    setPassword,
    isValid,
    emailError: showEmailError ? EMAIL_ERROR_MESSAGE : undefined,
    passwordError: showPasswordError ? PASSWORD_ERROR_MESSAGE : undefined,
    handleEmailBlur,
    handleSubmit,
  };
}
