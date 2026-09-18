// spec: docs/frontend/auth-components.md#otpmodal (state machine, countdown, mock verify)
import { useEffect, useRef, useState } from "react";

export const OTP_LENGTH = 6;
export const OTP_ERROR_MESSAGE = "Enter the correct code";
export const RESEND_COUNTDOWN_SECONDS = 59;
export const MOCK_VERIFY_DELAY_MS = 800;
export const MOCK_VALID_CODE = "123456";

export type OtpStatus = "idle" | "verifying" | "error";

export interface UseOtpModalOptions {
  open: boolean;
  onSubmit?: (code: string) => void;
  onVerified?: (code: string) => void;
}

export interface UseOtpModalResult {
  code: string;
  setCode: (next: string) => void;
  status: OtpStatus;
  errorMessage: string | undefined;
  resendLabel: string;
}

function formatCountdown(seconds: number): string {
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return `Resend in ${mm}:${ss}`;
}

export function useOtpModal({
  open,
  onSubmit,
  onVerified,
}: UseOtpModalOptions): UseOtpModalResult {
  const [code, setCodeState] = useState("");
  const [status, setStatus] = useState<OtpStatus>("idle");
  const [remaining, setRemaining] = useState(RESEND_COUNTDOWN_SECONDS);
  const verifyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(() => {
    if (open) {
      setCodeState("");
      setStatus("idle");
      setRemaining(RESEND_COUNTDOWN_SECONDS);
      if (verifyTimerRef.current !== undefined) {
        clearTimeout(verifyTimerRef.current);
        verifyTimerRef.current = undefined;
      }
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => {
      setRemaining((prev) => (prev > 0 ? prev - 1 : prev));
    }, 1000);
    return () => clearInterval(id);
  }, [open]);

  useEffect(() => {
    return () => {
      if (verifyTimerRef.current !== undefined) {
        clearTimeout(verifyTimerRef.current);
      }
    };
  }, []);

  function setCode(next: string) {
    setCodeState(next);

    if (status !== "idle") {
      if (verifyTimerRef.current !== undefined) {
        clearTimeout(verifyTimerRef.current);
        verifyTimerRef.current = undefined;
      }
      setStatus("idle");
    }

    if (next.length === OTP_LENGTH) {
      setStatus("verifying");
      onSubmit?.(next);
      verifyTimerRef.current = setTimeout(() => {
        verifyTimerRef.current = undefined;
        if (next === MOCK_VALID_CODE) {
          setStatus("idle");
          onVerified?.(next);
        } else {
          setStatus("error");
        }
      }, MOCK_VERIFY_DELAY_MS);
    }
  }

  const resendLabel = remaining > 0 ? formatCountdown(remaining) : "Resend";

  return {
    code,
    setCode,
    status,
    errorMessage: status === "error" ? OTP_ERROR_MESSAGE : undefined,
    resendLabel,
  };
}
