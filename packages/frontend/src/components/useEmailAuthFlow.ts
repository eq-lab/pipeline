// spec: docs/frontend/auth-components.md#emailauthflow
import { useEffect, useRef, useState } from "react";
import { ApiError, login, resendOtp, signup, verifyOtp } from "@/api";
import { saveSession } from "@/auth/session";
import type { TurnstileHandle } from "@/components/Turnstile";

export type EmailAuthScreen =
  | "sign-in"
  | "create-account"
  | "forgot-password"
  | "otp";

export interface UseEmailAuthFlowOptions {
  open: boolean;
  initialScreen?: EmailAuthScreen;
  onClose: () => void;
  onAuthenticated?: () => void;
  onConnectWallet?: () => void;
}

const NETWORK_ERROR_MESSAGE =
  "Network error — check your connection and try again.";
const LOCKOUT_ERROR_MESSAGE = "Too many attempts. Try again in a minute.";
const SUSPENDED_ERROR_MESSAGE = "This account is suspended. Contact support.";
const INVALID_CREDENTIALS_MESSAGE = "Incorrect email or password";
const CAPTCHA_NOT_READY_MESSAGE =
  "Verification is still loading — please try again in a moment.";

function describeApiError(error: unknown): string {
  if (error instanceof ApiError) return error.message || NETWORK_ERROR_MESSAGE;
  return NETWORK_ERROR_MESSAGE;
}

export function useEmailAuthFlow({
  open,
  initialScreen = "sign-in",
  onClose,
  onAuthenticated,
  onConnectWallet,
}: UseEmailAuthFlowOptions) {
  const [screen, setScreen] = useState<EmailAuthScreen>(initialScreen);
  const [pendingEmail, setPendingEmail] = useState("");
  const [passwordServerError, setPasswordServerError] = useState<string>();
  const [signInFormError, setSignInFormError] = useState<string>();
  const [createAccountFormError, setCreateAccountFormError] =
    useState<string>();
  const [signupCaptchaToken, setSignupCaptchaToken] = useState<string>();
  const [otpCaptchaToken, setOtpCaptchaToken] = useState<string>();
  const autoResendPendingRef = useRef(false);
  const signupTurnstileRef = useRef<TurnstileHandle>(null);
  const otpTurnstileRef = useRef<TurnstileHandle>(null);

  function clearSignInErrors() {
    setPasswordServerError(undefined);
    setSignInFormError(undefined);
  }

  useEffect(() => {
    if (!open) return;
    setScreen(initialScreen);
    setPendingEmail("");
    clearSignInErrors();
    setCreateAccountFormError(undefined);
    autoResendPendingRef.current = false;
  }, [open, initialScreen]);

  useEffect(() => {
    if (open) return;
    setSignupCaptchaToken(undefined);
    setOtpCaptchaToken(undefined);
    signupTurnstileRef.current?.reset();
    otpTurnstileRef.current?.reset();
  }, [open]);

  useEffect(() => {
    if (!autoResendPendingRef.current || !otpCaptchaToken) return;
    autoResendPendingRef.current = false;
    resendOtp({ email: pendingEmail, captchaToken: otpCaptchaToken })
      .catch(() => {})
      .finally(() => {
        otpTurnstileRef.current?.reset();
        setOtpCaptchaToken(undefined);
      });
  }, [otpCaptchaToken, pendingEmail]);

  function dismiss() {
    onClose();
  }

  function handleContinueWithWallet() {
    onClose();
    onConnectWallet?.();
  }

  async function handleSignInSubmit({
    email,
    password,
  }: {
    email: string;
    password: string;
  }) {
    setPasswordServerError(undefined);
    setSignInFormError(undefined);
    try {
      const session = await login({ email, password });
      saveSession(session);
      onClose();
      onAuthenticated?.();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setPasswordServerError(INVALID_CREDENTIALS_MESSAGE);
      } else if (error instanceof ApiError && error.status === 403) {
        if (error.message === "email_not_verified") {
          setPendingEmail(email);
          autoResendPendingRef.current = true;
          setScreen("otp");
        } else {
          setSignInFormError(SUSPENDED_ERROR_MESSAGE);
        }
      } else if (error instanceof ApiError && error.status === 429) {
        setSignInFormError(LOCKOUT_ERROR_MESSAGE);
      } else {
        setSignInFormError(describeApiError(error));
      }
      throw error;
    }
  }

  async function handleCreateAccountSubmit({
    email,
    password,
  }: {
    email: string;
    password: string;
  }) {
    setCreateAccountFormError(undefined);
    const captchaToken = signupCaptchaToken;
    if (!captchaToken) {
      setCreateAccountFormError(CAPTCHA_NOT_READY_MESSAGE);
      return;
    }
    try {
      await signup({ email, password, captchaToken });
      setPendingEmail(email);
      setScreen("otp");
    } catch (error) {
      setCreateAccountFormError(describeApiError(error));
      throw error;
    } finally {
      signupTurnstileRef.current?.reset();
      setSignupCaptchaToken(undefined);
    }
  }

  async function handleOtpVerify(code: string) {
    const session = await verifyOtp({ email: pendingEmail, code });
    saveSession(session);
    onClose();
    onAuthenticated?.();
  }

  async function handleOtpResend() {
    const captchaToken = otpCaptchaToken;
    if (!captchaToken) {
      throw new Error(CAPTCHA_NOT_READY_MESSAGE);
    }
    try {
      await resendOtp({ email: pendingEmail, captchaToken });
    } finally {
      otpTurnstileRef.current?.reset();
      setOtpCaptchaToken(undefined);
    }
  }

  return {
    screen,
    pendingEmail,
    passwordServerError,
    signInFormError,
    createAccountFormError,
    signupCaptchaReady: signupCaptchaToken !== undefined,
    signupTurnstileRef,
    otpTurnstileRef,
    onSignupToken: setSignupCaptchaToken,
    onOtpToken: setOtpCaptchaToken,
    handleSignInSubmit,
    handleCreateAccountSubmit,
    handleOtpVerify,
    handleOtpResend,
    handleContinueWithWallet,
    dismiss,
    clearSignInErrors,
    goToSignIn: () => {
      clearSignInErrors();
      setScreen("sign-in");
    },
    goToCreateAccount: () => {
      clearSignInErrors();
      setScreen("create-account");
    },
    goToForgotPassword: () => {
      clearSignInErrors();
      setScreen("forgot-password");
    },
  };
}
