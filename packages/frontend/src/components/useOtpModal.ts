// spec: docs/frontend/auth-components.md#otpmodal
import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/api";

export const OTP_LENGTH = 6;
export const OTP_ERROR_MESSAGE =
  "Code is incorrect or expired. Request a new one.";
export const RESEND_COUNTDOWN_SECONDS = 59;
export const RESEND_ERROR_MESSAGE = "Couldn't resend the code. Try again.";
export const AUTO_RESEND_ERROR_MESSAGE = "The code was not sent. Try again.";
export const RESEND_ACCEPTED_MESSAGE =
  "Request accepted. If no code arrives, retry after the countdown.";
export const OTP_NETWORK_ERROR_MESSAGE =
  "Network error — check your connection and try again.";
export const OTP_ERROR_VISIBLE_MS = 3000;

export type OtpStatus = "idle" | "verifying" | "error";

export interface UseOtpModalOptions {
  open: boolean;
  verify?: (code: string) => Promise<void>;
  resend?: () => Promise<void>;
  onVerified?: (code: string) => void;
  autoResendResult?: { id: number; status: "success" | "error" };
}

export interface UseOtpModalResult {
  code: string;
  setCode: (next: string) => void;
  status: OtpStatus;
  errorMessage: string | undefined;
  resendLabel: string;
  resendEnabled: boolean;
  resendError: string | undefined;
  resendNotice: string | undefined;
  onResend: () => void;
  focusRequestId: number;
}

function formatCountdown(seconds: number): string {
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return `Resend in ${mm}:${ss}`;
}

export function useOtpModal({
  open,
  verify,
  resend,
  onVerified,
  autoResendResult,
}: UseOtpModalOptions): UseOtpModalResult {
  const [code, setCodeState] = useState("");
  const [status, setStatus] = useState<OtpStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string>();
  const [remaining, setRemaining] = useState(RESEND_COUNTDOWN_SECONDS);
  const [isResending, setIsResending] = useState(false);
  const [resendError, setResendError] = useState<string>();
  const [resendNotice, setResendNotice] = useState<string>();
  const [allowImmediateResend, setAllowImmediateResend] = useState(false);
  const [errorSeq, setErrorSeq] = useState(0);
  const [focusRequestId, setFocusRequestId] = useState(0);
  const requestIdRef = useRef(0);
  const resendRequestIdRef = useRef(0);

  useEffect(() => {
    if (open) {
      setCodeState("");
      setStatus("idle");
      setErrorMessage(undefined);
      setRemaining(RESEND_COUNTDOWN_SECONDS);
      setIsResending(false);
      setResendError(undefined);
      setResendNotice(undefined);
      setAllowImmediateResend(false);
      setErrorSeq(0);
      requestIdRef.current += 1;
      resendRequestIdRef.current += 1;
    } else {
      requestIdRef.current += 1;
      resendRequestIdRef.current += 1;
    }
  }, [open]);

  useEffect(() => {
    if (!open || !autoResendResult) return;
    if (autoResendResult.status === "success") {
      setResendError(undefined);
      setResendNotice(undefined);
      setAllowImmediateResend(false);
      setRemaining(RESEND_COUNTDOWN_SECONDS);
    } else {
      setResendError(AUTO_RESEND_ERROR_MESSAGE);
      setResendNotice(undefined);
      setAllowImmediateResend(true);
    }
  }, [open, autoResendResult]);

  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => {
      setRemaining((prev) => (prev > 0 ? prev - 1 : prev));
    }, 1000);
    return () => clearInterval(id);
  }, [open]);

  useEffect(() => {
    if (!open || status !== "error") return;
    const id = setTimeout(() => {
      setCodeState("");
      setStatus("idle");
      setErrorMessage(undefined);
      requestIdRef.current += 1;
      setFocusRequestId((n) => n + 1);
    }, OTP_ERROR_VISIBLE_MS);
    return () => clearTimeout(id);
  }, [open, status, errorSeq]);

  function setCode(next: string) {
    if (status === "verifying" && next === code) return;

    const requestId = ++requestIdRef.current;
    setCodeState(next);
    if (status !== "idle") setStatus("idle");
    setErrorMessage(undefined);

    if (next.length === OTP_LENGTH) {
      setStatus("verifying");
      const verifyFn =
        verify ?? (() => Promise.reject(new Error("no verify wired")));
      verifyFn(next).then(
        () => {
          if (requestIdRef.current !== requestId) return;
          setStatus("idle");
          onVerified?.(next);
        },
        (error: unknown) => {
          if (requestIdRef.current !== requestId) return;
          setStatus("error");
          setErrorMessage(
            error instanceof ApiError && error.status === 401
              ? OTP_ERROR_MESSAGE
              : OTP_NETWORK_ERROR_MESSAGE,
          );
          setErrorSeq((n) => n + 1);
          setFocusRequestId((n) => n + 1);
        },
      );
    }
  }

  function onResend() {
    if ((remaining > 0 && !allowImmediateResend) || isResending) return;
    setCodeState("");
    setStatus("idle");
    setErrorMessage(undefined);
    requestIdRef.current += 1;
    setFocusRequestId((n) => n + 1);
    setResendError(undefined);
    setResendNotice(undefined);
    setIsResending(true);
    const requestId = ++resendRequestIdRef.current;
    const resendFn = resend ?? (() => Promise.resolve());
    resendFn().then(
      () => {
        if (resendRequestIdRef.current !== requestId) return;
        setIsResending(false);
        setRemaining(RESEND_COUNTDOWN_SECONDS);
        setAllowImmediateResend(false);
        setResendNotice(RESEND_ACCEPTED_MESSAGE);
      },
      (error: unknown) => {
        if (resendRequestIdRef.current !== requestId) return;
        setIsResending(false);
        setResendError(
          error instanceof Error && error.message.startsWith("Verification")
            ? error.message
            : RESEND_ERROR_MESSAGE,
        );
        setAllowImmediateResend(true);
      },
    );
  }

  return {
    code,
    setCode,
    status,
    errorMessage: status === "error" ? errorMessage : undefined,
    resendLabel:
      remaining > 0 && !allowImmediateResend
        ? formatCountdown(remaining)
        : "Resend",
    resendEnabled: (remaining === 0 || allowImmediateResend) && !isResending,
    resendError,
    resendNotice,
    onResend,
    focusRequestId,
  };
}
