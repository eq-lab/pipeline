// spec: docs/frontend/auth-components.md#accountinreviewmodal (Figma nodes
// 6486:81745 / 6486:81764 — default / notified states)
import { useEffect, useState } from "react";
import { Button } from "@pipeline/ui";
import { AuthModalShell } from "@/components/AuthModalShell";

// ── Icons ─────────────────────────────────────────────────────────────────────

function ShieldCheckIcon() {
  return (
    <svg
      viewBox="0 0 36 36"
      width={36}
      height={36}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        fill="currentColor"
        d="M17.5708 3.2343C17.8554 3.19318 18.1446 3.19318 18.4292 3.2343C18.75 3.28066 19.0624 3.39887 19.686 3.63273L26.8857 6.33244C28.0084 6.75342 28.5697 6.96395 28.9834 7.32854C29.3489 7.65065 29.6304 8.05681 29.8037 8.51213C29.9998 9.02757 30 9.62732 30 10.8266V13.5878C30 17.8993 29.9993 20.055 29.3979 22.0019C28.8476 23.7834 27.9348 25.4322 26.7158 26.8432C25.3836 28.3851 23.5548 29.5282 19.8984 31.8134C19.2155 32.2402 18.8741 32.4537 18.5083 32.5385C18.1739 32.6161 17.8261 32.6161 17.4917 32.5385C17.1259 32.4537 16.7845 32.2402 16.1016 31.8134C12.4452 29.5282 10.6164 28.3851 9.28418 26.8432C8.06522 25.4322 7.15242 23.7834 6.60205 22.0019C6.00067 20.055 6 17.8993 6 13.5878V10.8266C6 9.62732 6.00015 9.02757 6.19629 8.51213C6.36955 8.05681 6.65111 7.65065 7.0166 7.32854C7.4303 6.96395 7.99165 6.75342 9.11426 6.33244L16.314 3.63273C16.9376 3.39887 17.25 3.28066 17.5708 3.2343ZM24.7954 13.4545C24.3561 13.0152 23.6439 13.0152 23.2046 13.4545L15.75 20.9091L12.7954 17.9545C12.3561 17.5152 11.6439 17.5152 11.2046 17.9545C10.7653 18.3938 10.7653 19.106 11.2046 19.5453L14.9546 23.2953C15.3939 23.7347 16.1061 23.7347 16.5454 23.2953L24.7954 15.0453C25.2347 14.606 25.2347 13.8938 24.7954 13.4545Z"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={24}
      height={24}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        fill="currentColor"
        d="M20.5303 5.96967C20.8232 6.26256 20.8232 6.73744 20.5303 7.03033L9.53033 18.0303C9.23744 18.3232 8.76256 18.3232 8.46967 18.0303L3.46967 13.0303C3.17678 12.7374 3.17678 12.2626 3.46967 11.9697C3.76256 11.6768 4.23744 11.6768 4.53033 11.9697L9 16.4393L19.4697 5.96967C19.7626 5.67678 20.2374 5.67678 20.5303 5.96967Z"
      />
    </svg>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface AccountInReviewModalProps {
  open: boolean;
  onDismiss: () => void;
  onNotifyMe?: () => void;
  onGoToApp?: () => void;
}

// ── Modal component ───────────────────────────────────────────────────────────

export function AccountInReviewModal({
  open,
  onDismiss,
  onNotifyMe,
  onGoToApp,
}: AccountInReviewModalProps) {
  const [notified, setNotified] = useState(false);

  useEffect(() => {
    if (open) setNotified(false);
  }, [open]);

  const handleNotify = () => {
    setNotified(true);
    onNotifyMe?.();
  };

  return (
    <AuthModalShell
      open={open}
      onDismiss={onDismiss}
      heading="Your account is under review"
      headingId="account-in-review-modal-heading"
      testId="account-in-review-modal"
      description="It can take up to 2 weeks. We can notify you when it’s ready."
      showImagePanel={false}
      align="center"
      headingAlign="center"
      icon={
        <span className="flex size-18 items-center justify-center rounded-[var(--radius-pipeline-pill)] bg-[color:var(--color-pipeline-fill-muted)] text-[color:var(--color-pipeline-ink-subtle)]">
          <ShieldCheckIcon />
        </span>
      }
    >
      <div className="mt-2 flex w-full flex-col gap-2 pb-16" aria-live="polite">
        <Button
          variant={notified ? "secondary" : "primary-dark"}
          className={[
            "!w-full !min-w-0",
            notified
              ? "!bg-[color:var(--color-pipeline-positive-secondary)] !text-[color:var(--color-pipeline-positive-strong)]"
              : "",
          ].join(" ")}
          aria-disabled={notified || undefined}
          onClick={notified ? undefined : handleNotify}
        >
          {notified ? (
            <span className="flex items-center gap-2">
              <CheckIcon />
              We’ll notify you
            </span>
          ) : (
            "Notify me"
          )}
        </Button>

        <Button
          variant="secondary"
          className="!w-full !min-w-0 !bg-[color:var(--color-pipeline-fill-muted)] hover:!bg-[color-mix(in_oklab,var(--color-pipeline-fill-muted)_92%,black)]"
          onClick={() => onGoToApp?.()}
        >
          Go to app
        </Button>
      </div>
    </AuthModalShell>
  );
}

export default AccountInReviewModal;
