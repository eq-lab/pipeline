// spec: docs/frontend/auth-components.md#resetpasswordmodal
import { Button, TextField } from "@pipeline/ui";
import { AuthModalShell } from "@/components/AuthModalShell";
import { useResetPasswordForm } from "@/components/useResetPasswordForm";

export type ResetPasswordView = "form" | "expired" | "done";

export interface ResetPasswordModalProps {
  open: boolean;
  onDismiss: () => void;
  view: ResetPasswordView;
  onSubmit?: (payload: { password: string }) => void | Promise<void>;
  onPasswordEdit?: () => void;
  formError?: string;
  passwordServerError?: string;
  onSignIn?: () => void;
  onRequestNewLink?: () => void;
}

const COPY: Record<
  ResetPasswordView,
  { heading: string; description: string }
> = {
  form: {
    heading: "Set a new password",
    description: "Choose a new password for your account.",
  },
  expired: {
    heading: "This link has expired",
    description:
      "Password reset links work once and expire after a short while. Request a new one to continue.",
  },
  done: {
    heading: "Password updated",
    description:
      "Your password has been changed and every other session was signed out. Sign in with your new password to continue.",
  },
};

const CAPTION_CLASS = [
  "w-full text-center",
  "font-[family-name:var(--font-body)]",
  "text-[length:var(--text-pipeline-caption)]",
  "leading-[var(--text-pipeline-caption--line-height)]",
].join(" ");

const LINK_CLASS = [
  "cursor-pointer bg-transparent",
  "text-[color:var(--color-pipeline-ink)]",
  "hover:underline",
  "focus-visible:outline focus-visible:outline-2",
  "focus-visible:outline-offset-2",
  "focus-visible:outline-[color:var(--color-pipeline-ink)]",
].join(" ");

const ALERT_CLASS = [
  "w-full text-center",
  "font-[family-name:var(--font-body)]",
  "text-[length:var(--text-pipeline-body-s)]",
  "leading-[var(--text-pipeline-body-s--line-height)]",
  "text-[color:var(--color-pipeline-negative-strong)]",
].join(" ");

export function ResetPasswordModal({
  open,
  onDismiss,
  view,
  onSubmit,
  onPasswordEdit,
  formError,
  passwordServerError,
  onSignIn,
  onRequestNewLink,
}: ResetPasswordModalProps) {
  const headingId = "reset-password-modal-heading";
  const {
    password,
    setPassword,
    isValid,
    isSubmitting,
    passwordError,
    handlePasswordBlur,
    handleSubmit,
  } = useResetPasswordForm({ open, onSubmit });

  return (
    <AuthModalShell
      open={open}
      onDismiss={onDismiss}
      heading={COPY[view].heading}
      description={COPY[view].description}
      headingId={headingId}
      testId="reset-password-modal"
      align="center"
    >
      {view === "form" ? (
        <form
          onSubmit={handleSubmit}
          className="mt-2 flex w-full flex-col items-center gap-8 pb-16"
        >
          <TextField
            type="password"
            autoComplete="new-password"
            placeholder="New password"
            value={password}
            onChange={(next) => {
              setPassword(next);
              onPasswordEdit?.();
            }}
            onBlur={handlePasswordBlur}
            invalid={Boolean(passwordError || passwordServerError)}
            error={passwordError ?? passwordServerError}
          />

          {formError ? (
            <p role="alert" className={ALERT_CLASS}>
              {formError}
            </p>
          ) : null}

          <Button
            type="submit"
            variant="primary-blue"
            disabled={!isValid || isSubmitting}
            className="!w-full !min-w-0 disabled:opacity-[0.32]"
          >
            Save new password
          </Button>
        </form>
      ) : view === "expired" ? (
        <div className="mt-2 flex w-full flex-col items-center gap-8 pb-16">
          <Button
            type="button"
            variant="primary-blue"
            onClick={onRequestNewLink}
            className="!w-full !min-w-0"
          >
            Request a new link
          </Button>
          <p className={CAPTION_CLASS}>
            <span className="text-[color:var(--color-pipeline-ink-muted)]">
              Remembered it?{" "}
            </span>
            <button type="button" onClick={onSignIn} className={LINK_CLASS}>
              Back to sign in
            </button>
          </p>
        </div>
      ) : (
        <div className="mt-2 flex w-full flex-col items-center gap-8 pb-16">
          <Button
            type="button"
            variant="primary-blue"
            onClick={onSignIn}
            className="!w-full !min-w-0"
          >
            Sign in
          </Button>
        </div>
      )}
    </AuthModalShell>
  );
}

export default ResetPasswordModal;
