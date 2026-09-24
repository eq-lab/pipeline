// spec: docs/frontend/auth-components.md#otpmodal
import { useEffect, useRef, useState } from "react";

export const OTP_LENGTH = 6;
export const OTP_ERROR_MESSAGE =
  "Code is incorrect or expired. Request a new one.";
export const RESEND_COUNTDOWN_SECONDS = 59;

export type OtpStatus = "idle" | "verifying" | "error";

export interface UseOtpModalOptions {
  open: boolean;
  verify?: (code: string) => Promise<void>;
  resend?: () => Promise<void>;
  onVerified?: (code: string) => void;
}

export interface UseOtpModalResult {
  code: string;
  setCode: (next: string) => void;
  status: OtpStatus;
  errorMessage: string | undefined;
  resendLabel: string;
  resendEnabled: boolean;
  onResend: () => void;
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
}: UseOtpModalOptions): UseOtpModalResult {
  const [code, setCodeState] = useState("");
  const [status, setStatus] = useState<OtpStatus>("idle");
  const [remaining, setRemaining] = useState(RESEND_COUNTDOWN_SECONDS);
  const [isResending, setIsResending] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (open) {
      setCodeState("");
      setStatus("idle");
      setRemaining(RESEND_COUNTDOWN_SECONDS);
      setIsResending(false);
      requestIdRef.current += 1;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => {
      setRemaining((prev) => (prev > 0 ? prev - 1 : prev));
    }, 1000);
    return () => clearInterval(id);
  }, [open]);

  function setCode(next: string) {
    if (status === "verifying" && next === code) return;

    setCodeState(next);
    if (status !== "idle") setStatus("idle");

    if (next.length === OTP_LENGTH) {
      const requestId = ++requestIdRef.current;
      setStatus("verifying");
      const verifyFn =
        verify ?? (() => Promise.reject(new Error("no verify wired")));
      verifyFn(next).then(
        () => {
          if (requestIdRef.current !== requestId) return;
          setStatus("idle");
          onVerified?.(next);
        },
        () => {
          if (requestIdRef.current !== requestId) return;
          setStatus("error");
        },
      );
    }
  }

  function onResend() {
    if (remaining > 0 || isResending) return;
    setIsResending(true);
    const resendFn = resend ?? (() => Promise.resolve());
    resendFn()
      .catch(() => {})
      .finally(() => {
        setIsResending(false);
        setRemaining(RESEND_COUNTDOWN_SECONDS);
      });
  }

  return {
    code,
    setCode,
    status,
    errorMessage: status === "error" ? OTP_ERROR_MESSAGE : undefined,
    resendLabel: remaining > 0 ? formatCountdown(remaining) : "Resend",
    resendEnabled: remaining === 0 && !isResending,
    onResend,
  };
}
