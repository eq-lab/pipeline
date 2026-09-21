// spec: docs/frontend/auth-components.md#signinmodal
import { useEffect, useState } from "react";

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const EMAIL_ERROR_MESSAGE = "Enter the correct email address";
export const PASSWORD_ERROR_MESSAGE = "Enter the correct password";
export const PASSWORD_POLICY_ERROR_MESSAGE =
  "At least 8 characters, including a number and a special character";

function meetsPasswordPolicy(password: string): boolean {
  return (
    password.length >= 8 && /\d/.test(password) && /[^A-Za-z0-9]/.test(password)
  );
}

export interface UseAuthCredentialsFormOptions {
  open: boolean;
  onSubmit?: (credentials: { email: string; password: string }) => void;
  passwordRule?: "non-empty" | "policy";
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
  handlePasswordBlur: () => void;
  handleSubmit: (e: React.FormEvent) => void;
}

export function useAuthCredentialsForm({
  open,
  onSubmit,
  passwordRule = "non-empty",
}: UseAuthCredentialsFormOptions): UseAuthCredentialsFormResult {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  useEffect(() => {
    if (open) {
      setEmail("");
      setPassword("");
      setEmailTouched(false);
      setPasswordTouched(false);
      setSubmitAttempted(false);
    }
  }, [open]);

  const isEmailWellFormed = email !== "" && EMAIL_PATTERN.test(email);
  const isValid =
    isEmailWellFormed &&
    (passwordRule === "policy"
      ? meetsPasswordPolicy(password)
      : password !== "");

  const showEmailError =
    (emailTouched || submitAttempted) && email !== "" && !isEmailWellFormed;
  const showPasswordError =
    passwordRule === "policy"
      ? ((passwordTouched && password !== "") || submitAttempted) &&
        !meetsPasswordPolicy(password)
      : submitAttempted && password === "";

  function handleEmailBlur() {
    setEmailTouched(true);
  }

  function handlePasswordBlur() {
    setPasswordTouched(true);
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
    passwordError: showPasswordError
      ? passwordRule === "policy"
        ? PASSWORD_POLICY_ERROR_MESSAGE
        : PASSWORD_ERROR_MESSAGE
      : undefined,
    handleEmailBlur,
    handlePasswordBlur,
    handleSubmit,
  };
}
