// spec: docs/frontend/auth-components.md#createaccountmodal
import { Button, TextField } from "@pipeline/ui";
import { AuthModalShell } from "@/components/AuthModalShell";
import {
  ContinueWithWalletButton,
  OrDivider,
} from "@/components/AuthModalParts";
import { useAuthCredentialsForm } from "@/components/useAuthCredentialsForm";

// ── Props ─────────────────────────────────────────────────────────────────────

export interface CreateAccountModalProps {
  open: boolean;
  onDismiss: () => void;
  onSubmit?: (credentials: { email: string; password: string }) => void;
  onContinueWithWallet?: () => void;
}

// ── Modal component ───────────────────────────────────────────────────────────

export function CreateAccountModal({
  open,
  onDismiss,
  onSubmit,
  onContinueWithWallet,
}: CreateAccountModalProps) {
  const headingId = "create-account-modal-heading";
  const {
    email,
    setEmail,
    password,
    setPassword,
    isValid,
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

          <Button
            type="submit"
            variant="primary-blue"
            disabled={!isValid}
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
            <span className="text-[color:var(--color-pipeline-ink)]">
              Log in
            </span>
          </p>
        </div>
      </form>
    </AuthModalShell>
  );
}

export default CreateAccountModal;
