// spec: docs/frontend/auth-components.md#forgotpasswordmodal
import type { ReactNode } from "react";
import { Button, TextField } from "@pipeline/ui";
import { AuthModalShell } from "@/components/AuthModalShell";
import { CaptchaStatusNotice } from "@/components/AuthModalParts";
import { useForgotPasswordForm } from "@/components/useForgotPasswordForm";
import type { TurnstileStatus } from "@/components/Turnstile";

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ForgotPasswordModalProps {
  open: boolean;
  onDismiss: () => void;
  onSubmit?: (payload: { email: string }) => void | Promise<void>;
  onBackToSignIn?: () => void;
  formError?: string;
  captchaStatus?: TurnstileStatus;
  onCaptchaRetry?: () => void;
  turnstileSlot?: ReactNode;
}

// ── Modal component ───────────────────────────────────────────────────────────

export function ForgotPasswordModal({
  open,
  onDismiss,
  onSubmit,
  onBackToSignIn,
  formError,
  captchaStatus = "ready",
  onCaptchaRetry,
  turnstileSlot,
}: ForgotPasswordModalProps) {
  const headingId = "forgot-password-modal-heading";
  const {
    email,
    setEmail,
    isValid,
    isSubmitting,
    emailError,
    handleEmailBlur,
    handleSubmit,
  } = useForgotPasswordForm({ open, onSubmit });

  return (
    <AuthModalShell
      open={open}
      onDismiss={onDismiss}
      heading="Reset your password"
      headingId={headingId}
      testId="forgot-password-modal"
      align="center"
    >
      <form
        onSubmit={handleSubmit}
        data-node-id="6704:107100"
        className="mt-2 flex w-full flex-col items-center gap-8 pb-16"
      >
        <TextField
          type="email"
          autoComplete="email"
          placeholder="Enter corporate email"
          value={email}
          onChange={setEmail}
          onBlur={handleEmailBlur}
          invalid={Boolean(emailError)}
          error={emailError}
        />

        {turnstileSlot}

        <CaptchaStatusNotice
          status={captchaStatus}
          loadingMessage="Verification is loading. You can complete it before requesting a link."
          onRetry={onCaptchaRetry}
        />

        {formError ? (
          <p
            role="alert"
            className={[
              "w-full text-center",
              "font-[family-name:var(--font-body)]",
              "text-[length:var(--text-pipeline-body-s)]",
              "leading-[var(--text-pipeline-body-s--line-height)]",
              "text-[color:var(--color-pipeline-negative-strong)]",
            ].join(" ")}
          >
            {formError}
          </p>
        ) : null}

        <Button
          type="submit"
          variant="primary-blue"
          disabled={!isValid || isSubmitting}
          className="!w-full !min-w-0 disabled:opacity-[0.32]"
        >
          Send Reset Link
        </Button>

        <p
          className={[
            "w-full text-center",
            "font-[family-name:var(--font-body)]",
            "text-[length:var(--text-pipeline-caption)]",
            "leading-[var(--text-pipeline-caption--line-height)]",
          ].join(" ")}
        >
          <span className="text-[color:var(--color-pipeline-ink-muted)]">
            Remembered it?{" "}
          </span>
          <button
            type="button"
            onClick={onBackToSignIn}
            className={[
              "cursor-pointer bg-transparent",
              "text-[color:var(--color-pipeline-ink)]",
              "hover:underline",
              "focus-visible:outline focus-visible:outline-2",
              "focus-visible:outline-offset-2",
              "focus-visible:outline-[color:var(--color-pipeline-ink)]",
            ].join(" ")}
          >
            Back to sign in
          </button>
        </p>
      </form>
    </AuthModalShell>
  );
}

export default ForgotPasswordModal;
