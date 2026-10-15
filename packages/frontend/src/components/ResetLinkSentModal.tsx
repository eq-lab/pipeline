// spec: docs/frontend/auth-components.md#resetlinksentmodal
import { Button } from "@pipeline/ui";
import { AuthModalShell } from "@/components/AuthModalShell";

export interface ResetLinkSentModalProps {
  open: boolean;
  onDismiss: () => void;
  onBackToSignIn: () => void;
  onTryAgain: () => void;
  email?: string;
}

export function ResetLinkSentModal({
  open,
  onDismiss,
  onBackToSignIn,
  onTryAgain,
  email,
}: ResetLinkSentModalProps) {
  const headingId = "reset-link-sent-modal-heading";
  const target = email ? email : "that address";

  return (
    <AuthModalShell
      open={open}
      onDismiss={onDismiss}
      onBack={onBackToSignIn}
      heading="Check your inbox"
      description={`If an account exists for ${target}, a password reset link is on its way. Follow it to set a new password.`}
      headingId={headingId}
      testId="reset-link-sent-modal"
      showImagePanel={false}
      showCloseButton={false}
      align="center"
    >
      <div className="mt-2 flex w-full flex-col items-center gap-8 pb-16">
        <Button
          type="button"
          variant="primary-blue"
          onClick={onBackToSignIn}
          className="!w-full !min-w-0"
        >
          Back to sign in
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
            Didn’t get it?{" "}
          </span>
          <button
            type="button"
            onClick={onTryAgain}
            className={[
              "cursor-pointer bg-transparent",
              "text-[color:var(--color-pipeline-ink)]",
              "hover:underline",
              "focus-visible:outline focus-visible:outline-2",
              "focus-visible:outline-offset-2",
              "focus-visible:outline-[color:var(--color-pipeline-ink)]",
            ].join(" ")}
          >
            Try again
          </button>
        </p>
      </div>
    </AuthModalShell>
  );
}

export default ResetLinkSentModal;
