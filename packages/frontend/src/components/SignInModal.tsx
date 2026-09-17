// spec: docs/frontend/auth-components.md#signinmodal (Figma nodes 6486:81557 /
// 6486:81576 / 6486:81595 — default / enabled / validation-error states).
import { Button, TextField } from "@pipeline/ui";
import { AuthModalShell } from "@/components/AuthModalShell";
import { useSignInModal } from "@/components/useSignInModal";

// ── Inline SVG icons ──────────────────────────────────────────────────────────

function WalletIcon() {
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
        d="M17.7998 4C18.9199 4 19.4804 3.99979 19.9082 4.21777C20.2845 4.40951 20.5905 4.71554 20.7822 5.0918C21.0002 5.51962 21 6.08009 21 7.2002V8.5H18C16.067 8.5 14.5 10.067 14.5 12C14.5 13.933 16.067 15.5 18 15.5H21V16.7998C21 17.9199 21.0002 18.4804 20.7822 18.9082C20.5905 19.2845 20.2845 19.5905 19.9082 19.7822C19.4804 20.0002 18.9199 20 17.7998 20H6.2002C5.08009 20 4.51962 20.0002 4.0918 19.7822C3.71554 19.5905 3.40951 19.2845 3.21777 18.9082C2.99979 18.4804 3 17.9199 3 16.7998V7.2002C3 6.08009 2.99979 5.51962 3.21777 5.0918C3.40951 4.71554 3.71554 4.40951 4.0918 4.21777C4.51962 3.99979 5.08009 4 6.2002 4H17.7998Z"
        fill="currentColor"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M21 10C21.5523 10 22 10.4477 22 11V13C22 13.5523 21.5523 14 21 14H18C16.8954 14 16 13.1046 16 12C16 10.8954 16.8954 10 18 10H21ZM18 11C17.4477 11 17 11.4477 17 12C17 12.5523 17.4477 13 18 13C18.5523 13 19 12.5523 19 12C19 11.4477 18.5523 11 18 11Z"
        fill="currentColor"
      />
    </svg>
  );
}

// ── OR divider ────────────────────────────────────────────────────────────────

function OrDivider() {
  return (
    <div className="flex w-full items-center gap-2 py-3">
      <div className="h-px flex-1 bg-[color:var(--color-pipeline-ink-subtle)]" />
      <span
        className={[
          "shrink-0 uppercase",
          "font-[family-name:var(--font-body)]",
          "text-[length:var(--text-pipeline-caption)]",
          "leading-[var(--text-pipeline-caption--line-height)]",
          "font-[var(--font-weight-medium)]",
          "tracking-[var(--tracking-pipeline-label)]",
          "text-[color:var(--color-pipeline-ink-subtle)]",
        ].join(" ")}
      >
        OR
      </span>
      <div className="h-px flex-1 bg-[color:var(--color-pipeline-ink-subtle)]" />
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface SignInModalProps {
  open: boolean;
  onDismiss: () => void;
  /**
   * Seam for #1254. Receives the validated credentials. Defaults to a no-op —
   * #1248 ships no network call.
   */
  onSubmit?: (credentials: { email: string; password: string }) => void;
  /** Seam for #1254 — opens the wallet chooser. Defaults to a no-op. */
  onContinueWithWallet?: () => void;
}

// ── Modal component ───────────────────────────────────────────────────────────

export function SignInModal({
  open,
  onDismiss,
  onSubmit,
  onContinueWithWallet,
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
  } = useSignInModal({ open, onSubmit });

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
        <Button
          variant="secondary"
          onClick={onContinueWithWallet}
          className={[
            "!w-full !min-w-0 !justify-start !px-2",
            "!bg-[color:var(--color-pipeline-surface)]",
            "hover:!bg-[color-mix(in_oklab,var(--color-pipeline-surface)_92%,black)]",
          ].join(" ")}
        >
          <span className="flex items-center gap-2">
            <WalletIcon />
            <span className="font-[var(--font-weight-emphasized)]">
              Continue with wallet
            </span>
          </span>
        </Button>

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

          <p
            className={[
              "w-full text-center",
              "font-[family-name:var(--font-body)]",
              "text-[length:var(--text-pipeline-caption)]",
              "leading-[var(--text-pipeline-caption--line-height)]",
              "text-[color:var(--color-pipeline-ink)]",
            ].join(" ")}
          >
            Forgot password?
          </p>

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
