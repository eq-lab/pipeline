// spec: docs/frontend/auth-components.md#forgotpasswordmodal (Figma node
// 6704:107100 — one frame, no enabled/error/success variants in the design).
import { Button, TextField } from "@pipeline/ui";
import { AuthModalShell } from "@/components/AuthModalShell";
import { useForgotPasswordForm } from "@/components/useForgotPasswordForm";

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ForgotPasswordModalProps {
  open: boolean;
  onDismiss: () => void;
  onSubmit?: (payload: { email: string }) => void;
  onBackToSignIn?: () => void;
}

// ── Modal component ───────────────────────────────────────────────────────────

export function ForgotPasswordModal({
  open,
  onDismiss,
  onSubmit,
  onBackToSignIn,
}: ForgotPasswordModalProps) {
  const headingId = "forgot-password-modal-heading";
  const {
    email,
    setEmail,
    isValid,
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

        <Button
          type="submit"
          variant="primary-blue"
          disabled={!isValid}
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
