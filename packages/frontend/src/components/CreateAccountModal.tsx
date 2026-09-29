// spec: docs/frontend/auth-components.md#createaccountmodal
import type { ReactNode } from "react";
import { Button, TextField } from "@pipeline/ui";
import { AuthModalShell } from "@/components/AuthModalShell";
import {
  ContinueWithWalletButton,
  OrDivider,
} from "@/components/AuthModalParts";
import { useAuthCredentialsForm } from "@/components/useAuthCredentialsForm";
import type { TurnstileStatus } from "@/components/Turnstile";

// ── Props ─────────────────────────────────────────────────────────────────────

export interface CreateAccountModalProps {
  open: boolean;
  onDismiss: () => void;
  onSubmit?: (credentials: {
    email: string;
    password: string;
  }) => void | Promise<void>;
  onContinueWithWallet?: () => void;
  onSignIn?: () => void;
  formError?: string;
  captchaStatus?: TurnstileStatus;
  onCaptchaRetry?: () => void;
  turnstileSlot?: ReactNode;
}

// ── Modal component ───────────────────────────────────────────────────────────

export function CreateAccountModal({
  open,
  onDismiss,
  onSubmit,
  onContinueWithWallet,
  onSignIn,
  formError,
  captchaStatus = "ready",
  onCaptchaRetry,
  turnstileSlot,
}: CreateAccountModalProps) {
  const headingId = "create-account-modal-heading";
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
      onDismiss={onDismiss}
      heading="Create account"
      headingId={headingId}
      testId="create-account-modal"
    >
      <form
        onSubmit={handleSubmit}
        data-node-id="6486:81615"
        className="mt-2 flex w-full flex-col gap-4"
      >
        <ContinueWithWalletButton onClick={onContinueWithWallet} />

        <OrDivider />

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

          {captchaStatus !== "ready" ? (
            <div className="flex w-full flex-col items-center gap-2 text-center">
              <p
                role={captchaStatus === "loading" ? "status" : "alert"}
                className={[
                  "font-[family-name:var(--font-body)]",
                  "text-[length:var(--text-pipeline-caption)]",
                  "leading-[var(--text-pipeline-caption--line-height)]",
                  captchaStatus === "loading"
                    ? "text-[color:var(--color-pipeline-ink-muted)]"
                    : "text-[color:var(--color-pipeline-negative-strong)]",
                ].join(" ")}
              >
                {captchaStatus === "loading"
                  ? "Verification is loading. You can complete it before signing up."
                  : captchaStatus === "unavailable"
                    ? "Verification is unavailable. Please contact support."
                    : captchaStatus === "expired"
                      ? "Verification expired. Try again."
                      : "Verification failed to load. Try again."}
              </p>
              {captchaStatus === "error" || captchaStatus === "expired" ? (
                <button
                  type="button"
                  onClick={onCaptchaRetry}
                  className="cursor-pointer text-[color:var(--color-pipeline-ink)] underline"
                >
                  Retry verification
                </button>
              ) : null}
            </div>
          ) : null}

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
            Sign Up
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
              Already have an account?{" "}
            </span>
            <button
              type="button"
              onClick={onSignIn}
              className={[
                "text-[color:var(--color-pipeline-ink)]",
                "cursor-pointer bg-transparent",
                "hover:underline",
                "focus-visible:outline focus-visible:outline-2",
                "focus-visible:outline-offset-2",
                "focus-visible:outline-[color:var(--color-pipeline-ink)]",
              ].join(" ")}
            >
              Log in
            </button>
          </p>
        </div>
      </form>
    </AuthModalShell>
  );
}

export default CreateAccountModal;
