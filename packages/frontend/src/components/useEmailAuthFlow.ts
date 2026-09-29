// spec: docs/frontend/auth-components.md#emailauthflow
import { useEffect, useRef, useState } from "react";
import { ApiError, login, resendOtp, signup, verifyOtp } from "@/api";
import { saveSession } from "@/auth/session";
import type { TurnstileHandle, TurnstileStatus } from "@/components/Turnstile";

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
const CAPTCHA_FAILED_MESSAGE = "Verification failed to load. Try again.";
const CAPTCHA_EXPIRED_MESSAGE = "Verification expired. Try again.";
const CAPTCHA_UNAVAILABLE_MESSAGE =
  "Verification is unavailable. Please contact support.";

type AutoResendResult = { id: number; status: "success" | "error" };

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
  const [signupCaptchaStatus, setSignupCaptchaStatus] =
    useState<TurnstileStatus>("loading");
  const [otpCaptchaStatus, setOtpCaptchaStatus] =
    useState<TurnstileStatus>("loading");
  const [autoResendResult, setAutoResendResult] = useState<AutoResendResult>();
  const autoResendPendingRef = useRef(false);
  const flowGenerationRef = useRef(0);
  const autoResendIdRef = useRef(0);
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
    setAutoResendResult(undefined);
    autoResendPendingRef.current = false;
  }, [open, initialScreen]);

  useEffect(() => {
    if (open) return;
    setSignupCaptchaToken(undefined);
    setOtpCaptchaToken(undefined);
    setSignupCaptchaStatus("loading");
    setOtpCaptchaStatus("loading");
    setAutoResendResult(undefined);
    autoResendPendingRef.current = false;
    flowGenerationRef.current += 1;
    signupTurnstileRef.current?.reset();
    otpTurnstileRef.current?.reset();
  }, [open]);

  useEffect(() => {
    if (
      !open ||
      screen !== "otp" ||
      !autoResendPendingRef.current ||
      !otpCaptchaToken
    )
      return;
    autoResendPendingRef.current = false;
    const generation = flowGenerationRef.current;
    resendOtp({ email: pendingEmail, captchaToken: otpCaptchaToken })
      .then(
        () => {
          if (generation !== flowGenerationRef.current) return;
          setAutoResendResult({
            id: ++autoResendIdRef.current,
            status: "success",
          });
        },
        () => {
          if (generation !== flowGenerationRef.current) return;
          setAutoResendResult({
            id: ++autoResendIdRef.current,
            status: "error",
          });
        },
      )
      .finally(() => {
        if (generation !== flowGenerationRef.current) return;
        otpTurnstileRef.current?.reset();
        setOtpCaptchaToken(undefined);
      });
  }, [open, screen, otpCaptchaToken, pendingEmail]);

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
      saveSession({ ...session, email });
      onClose();
      onAuthenticated?.();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setPasswordServerError(INVALID_CREDENTIALS_MESSAGE);
      } else if (error instanceof ApiError && error.status === 403) {
        if (error.message === "email_not_verified") {
          flowGenerationRef.current += 1;
          setPendingEmail(email);
          setAutoResendResult(undefined);
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
      setCreateAccountFormError(
        signupCaptchaStatus === "error"
          ? undefined
          : signupCaptchaStatus === "expired"
            ? undefined
            : signupCaptchaStatus === "unavailable"
              ? undefined
              : CAPTCHA_NOT_READY_MESSAGE,
      );
      return;
    }
    try {
      await signup({ email, password, captchaToken });
      flowGenerationRef.current += 1;
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
    saveSession({ ...session, email: pendingEmail });
    onClose();
    onAuthenticated?.();
  }

  async function handleOtpResend() {
    const captchaToken = otpCaptchaToken;
    if (!captchaToken) {
      throw new Error(
        otpCaptchaStatus === "error"
          ? CAPTCHA_FAILED_MESSAGE
          : otpCaptchaStatus === "expired"
            ? CAPTCHA_EXPIRED_MESSAGE
            : otpCaptchaStatus === "unavailable"
              ? CAPTCHA_UNAVAILABLE_MESSAGE
              : CAPTCHA_NOT_READY_MESSAGE,
      );
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
    signupCaptchaStatus,
    otpCaptchaStatus,
    autoResendResult,
    signupTurnstileRef,
    otpTurnstileRef,
    onSignupToken: (token: string) => {
      setSignupCaptchaToken(token || undefined);
      if (token) {
        setSignupCaptchaStatus("ready");
        setCreateAccountFormError(undefined);
      }
    },
    onOtpToken: (token: string) => {
      setOtpCaptchaToken(token || undefined);
      if (token) setOtpCaptchaStatus("ready");
    },
    onSignupCaptchaStatus: (status: TurnstileStatus) => {
      setSignupCaptchaStatus(status);
      if (status !== "ready") setSignupCaptchaToken(undefined);
    },
    onOtpCaptchaStatus: (status: TurnstileStatus) => {
      setOtpCaptchaStatus(status);
      if (status !== "ready") setOtpCaptchaToken(undefined);
    },
    retrySignupCaptcha: () => signupTurnstileRef.current?.retry(),
    retryOtpCaptcha: () => otpTurnstileRef.current?.retry(),
    handleSignInSubmit,
    handleCreateAccountSubmit,
    handleOtpVerify,
    handleOtpResend,
    handleContinueWithWallet,
    dismiss,
    clearSignInErrors,
    goToSignIn: () => {
      flowGenerationRef.current += 1;
      autoResendPendingRef.current = false;
      setAutoResendResult(undefined);
      clearSignInErrors();
      setScreen("sign-in");
    },
    goToCreateAccount: () => {
      flowGenerationRef.current += 1;
      clearSignInErrors();
      setScreen("create-account");
    },
    goToForgotPassword: () => {
      flowGenerationRef.current += 1;
      clearSignInErrors();
      setScreen("forgot-password");
    },
  };
}
