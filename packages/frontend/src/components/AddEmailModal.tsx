// spec: docs/frontend/auth-components.md#addemailmodal
import type { ReactNode } from "react";
import { Button, TextField } from "@pipeline/ui";
import { AuthModalShell } from "@/components/AuthModalShell";
import { CaptchaStatusNotice } from "@/components/AuthModalParts";
import { useAuthCredentialsForm } from "@/components/useAuthCredentialsForm";
import type { TurnstileStatus } from "@/components/Turnstile";

// ── Props ─────────────────────────────────────────────────────────────────────

export interface AddEmailModalProps {
  open: boolean;
  onBack: () => void;
  onSubmit?: (credentials: {
    email: string;
    password: string;
  }) => void | Promise<void>;
  formError?: string;
  captchaStatus?: TurnstileStatus;
  onCaptchaRetry?: () => void;
  turnstileSlot?: ReactNode;
}

// ── Modal component ───────────────────────────────────────────────────────────

export function AddEmailModal({
  open,
  onBack,
  onSubmit,
  formError,
  captchaStatus = "ready",
  onCaptchaRetry,
  turnstileSlot,
}: AddEmailModalProps) {
  const headingId = "add-email-modal-heading";
  const {
    email,
    setEmail,
    password,
    setPassword,
    isValid,
    isSubmitting,
    emailError,
    passwordError,
    handleEmailBlur,
    handlePasswordBlur,
    handleSubmit,
  } = useAuthCredentialsForm({ open, onSubmit, passwordRule: "policy" });

  return (
    <AuthModalShell
      open={open}
      onDismiss={onBack}
      onBack={onBack}
      heading="Add email"
      description="Enter your corporate email and create a password"
      headingId={headingId}
      testId="add-email-modal"
      showImagePanel={false}
      showCloseButton={false}
      align="center"
    >
      <form
        onSubmit={handleSubmit}
        data-node-id="7129:15702"
        className="mt-6 flex w-full flex-col gap-12 pb-16"
      >
        <div className="flex w-full flex-col gap-8">
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
          <TextField
            type="password"
            autoComplete="new-password"
            placeholder="Password"
            value={password}
            onChange={setPassword}
            onBlur={handlePasswordBlur}
            invalid={Boolean(passwordError)}
            error={passwordError}
          />

          {turnstileSlot}

          <CaptchaStatusNotice
            status={captchaStatus}
            loadingMessage="Verification is loading. You can complete it before signing up."
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
        </div>

        <Button
          type="submit"
          variant="primary-blue"
          disabled={!isValid || isSubmitting}
          className="!w-full !min-w-0 disabled:opacity-[0.32]"
        >
          Save
        </Button>
      </form>
    </AuthModalShell>
  );
}

export default AddEmailModal;
