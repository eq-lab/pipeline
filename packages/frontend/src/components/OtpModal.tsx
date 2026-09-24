// spec: docs/frontend/auth-components.md#otpmodal
import type { ReactNode } from "react";
import { OtpInput } from "@pipeline/ui";
import { AuthModalShell } from "@/components/AuthModalShell";
import { useOtpModal } from "@/components/useOtpModal";

// ── Loader icon ───────────────────────────────────────────────────────────────

function LoaderIcon() {
  return (
    <svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M20.7805 10.7806C21.454 10.7806 22 11.3276 22 12.0011L21.9924 12.3955C21.9144 14.368 21.2536 16.2769 20.0897 17.8787C18.8484 19.587 17.0981 20.8581 15.0897 21.5106C13.0813 22.1631 10.9177 22.1632 8.9093 21.5106C6.90105 20.8579 5.15047 19.5861 3.9093 17.8777C2.66825 16.1693 2 14.1118 2 12.0001C2.00002 9.88836 2.66901 7.83105 3.91025 6.12258C5.15142 4.41423 6.9011 3.14235 8.9093 2.48971C10.7921 1.87792 12.8117 1.8392 14.7115 2.37443L15.0897 2.48971L15.2069 2.53354C15.7724 2.78299 16.068 3.42602 15.8729 4.02651C15.6777 4.62666 15.061 4.97246 14.4571 4.84207L14.3361 4.80872L14.0503 4.72202C12.614 4.31736 11.0873 4.34629 9.66387 4.80872C8.14547 5.3021 6.82188 6.26394 5.88338 7.55552C4.94487 8.8473 4.43904 10.4034 4.43902 12.0001C4.43902 13.5968 4.9449 15.153 5.88338 16.4448C6.82181 17.7362 8.14467 18.6981 9.66292 19.1916C11.1814 19.685 12.8176 19.6849 14.3361 19.1916C15.8546 18.6982 17.1781 17.7364 18.1166 16.4448C18.9965 15.2337 19.4962 13.7906 19.5553 12.2993L19.561 12.0001C19.5612 11.3268 20.1071 10.7806 20.7805 10.7806Z"
        fill="currentColor"
      />
    </svg>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface OtpModalProps {
  open: boolean;
  onBack: () => void;
  email?: string;
  verify?: (code: string) => Promise<void>;
  resend?: () => Promise<void>;
  onVerified?: (code: string) => void;
  turnstileSlot?: ReactNode;
}

// ── Modal component ───────────────────────────────────────────────────────────

export function OtpModal({
  open,
  onBack,
  email = "user@email.io",
  verify,
  resend,
  onVerified,
  turnstileSlot,
}: OtpModalProps) {
  const headingId = "otp-modal-heading";
  const {
    code,
    setCode,
    status,
    errorMessage,
    resendLabel,
    resendEnabled,
    onResend,
  } = useOtpModal({ open, verify, resend, onVerified });

  return (
    <AuthModalShell
      open={open}
      onDismiss={onBack}
      onBack={onBack}
      heading="Check your inbox"
      description={`We’ve sent a passcode to ${email}`}
      headingId={headingId}
      testId="otp-modal"
      showImagePanel={false}
      showCloseButton={false}
      align="center"
    >
      <div
        data-node-id="6486:81665"
        className="mt-2 flex w-full flex-col items-center gap-8 pb-16"
      >
        <OtpInput
          value={code}
          onChange={setCode}
          invalid={status === "error"}
          aria-label="Verification code"
        />

        {resendEnabled ? (
          <button
            type="button"
            onClick={onResend}
            className={[
              "text-center",
              "font-[family-name:var(--font-body)]",
              "text-[length:var(--text-pipeline-caption)]",
              "leading-[var(--text-pipeline-caption--line-height)]",
              "text-[color:var(--color-pipeline-ink)]",
              "cursor-pointer bg-transparent",
              "hover:underline",
              "focus-visible:outline focus-visible:outline-2",
              "focus-visible:outline-offset-2",
              "focus-visible:outline-[color:var(--color-pipeline-ink)]",
            ].join(" ")}
          >
            {resendLabel}
          </button>
        ) : (
          <p
            className={[
              "text-center",
              "font-[family-name:var(--font-body)]",
              "text-[length:var(--text-pipeline-caption)]",
              "leading-[var(--text-pipeline-caption--line-height)]",
              "text-[color:var(--color-pipeline-ink-muted)]",
            ].join(" ")}
          >
            {resendLabel}
          </p>
        )}
        {turnstileSlot}

        {status === "verifying" ? (
          <span
            role="status"
            aria-label="Verifying code"
            className="animate-spin text-[color:var(--color-pipeline-ink)]"
          >
            <LoaderIcon />
          </span>
        ) : status === "error" ? (
          <p
            role="alert"
            className={[
              "text-center",
              "font-[family-name:var(--font-body)]",
              "text-[length:var(--text-pipeline-body-s)]",
              "leading-[var(--text-pipeline-body-s--line-height)]",
              "text-[color:var(--color-pipeline-negative-strong)]",
            ].join(" ")}
          >
            {errorMessage}
          </p>
        ) : null}
      </div>
    </AuthModalShell>
  );
}

export default OtpModal;
