// spec: docs/frontend/auth-components.md#signinmodal
import { Button, TextField } from "@pipeline/ui";
import { AuthModalShell } from "@/components/AuthModalShell";
import {
  ContinueWithWalletButton,
  OrDivider,
} from "@/components/AuthModalParts";
import { useAuthCredentialsForm } from "@/components/useAuthCredentialsForm";

// ── Props ─────────────────────────────────────────────────────────────────────

export interface SignInModalProps {
  open: boolean;
  onDismiss: () => void;
  onSubmit?: (credentials: { email: string; password: string }) => void;
  onContinueWithWallet?: () => void;
  onForgotPassword?: () => void;
}

// ── Modal component ───────────────────────────────────────────────────────────

export function SignInModal({
  open,
  onDismiss,
  onSubmit,
  onContinueWithWallet,
  onForgotPassword,
}: SignInModalProps) {
  const headingId = "sign-in-modal-heading";
  const {
    email,
    setEmail,
    password,
    setPassword,
    isValid,
    emailError,
    passwordError,
    handleEmailBlur,
    handleSubmit,
  } = useAuthCredentialsForm({ open, onSubmit });

  return (
    <AuthModalShell
      open={open}
      onDismiss={onDismiss}
      heading="Sign in"
      headingId={headingId}
      testId="sign-in-modal"
    >
      <form
        onSubmit={handleSubmit}
        data-node-id="6486:81557"
        className="mt-2 flex w-full flex-col gap-4"
      >
        <ContinueWithWalletButton onClick={onContinueWithWallet} />

        <OrDivider />

        <div className="flex w-full flex-col gap-8">
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
              autoComplete="current-password"
              placeholder="Password"
              value={password}
              onChange={setPassword}
              invalid={Boolean(passwordError)}
              error={passwordError}
            />
          </div>

          <Button
            type="submit"
            variant="primary-blue"
            disabled={!isValid}
            className="!w-full !min-w-0 disabled:opacity-[0.32]"
          >
            Sign In
          </Button>

          <button
            type="button"
            onClick={onForgotPassword}
            className={[
              "w-full text-center",
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
            Forgot password?
          </button>

          <p
            className={[
              "w-full text-center",
              "font-[family-name:var(--font-body)]",
              "text-[length:var(--text-pipeline-caption)]",
              "leading-[var(--text-pipeline-caption--line-height)]",
            ].join(" ")}
          >
            <span className="text-[color:var(--color-pipeline-ink-muted)]">
              New here?{" "}
            </span>
            <span className="font-[var(--font-weight-emphasized)] text-[color:var(--color-pipeline-ink)]">
              Create account
            </span>
          </p>
        </div>
      </form>
    </AuthModalShell>
  );
}

export default SignInModal;
