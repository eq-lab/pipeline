import { Button } from "@pipeline/ui";
import { LockIcon } from "@/components/LockIcon";
import { useTrusteeSession } from "@/auth/TrusteeSessionProvider";

/**
 * SignInCard — the "Login Prompt" card from the Trustee sign-in overlay.
 *
 * spec: docs/frontend/trustee-flows.md#sign-in-card-figma-node-417433891-frame-4174-31660-unauthenticated-overlay
 * (Figma → token mapping), docs/frontend/trustee-flows.md#sign-in-flow-791-hardened-793794795.
 */
export function SignInCard() {
  const { status, error, signIn, signOut } = useTrusteeSession();
  const isConnecting = status === "connecting";
  const isUnauthorized = status === "unauthorized";

  return (
    <div
      className={[
        "flex w-[520px] max-w-full flex-col items-start gap-6 p-8",
        "rounded-[24px] border border-solid",
        "border-[color:var(--color-pipeline-line)]",
        "bg-[color:var(--color-pipeline-surface)]",
        "backdrop-blur-[16px]",
      ].join(" ")}
      data-testid="sign-in-card"
    >
      <div className="flex w-full flex-col items-center gap-3">
        <div
          className="flex size-14 shrink-0 items-center justify-center rounded-[28px] bg-[color:var(--color-pipeline-brand)]"
          aria-hidden="true"
        >
          <LockIcon className="text-[color:var(--color-pipeline-on-dark)]" />
        </div>

        <div className="flex w-full flex-col items-center gap-2 text-center">
          <h1 className="w-full font-[family-name:var(--font-display)] text-[36px] leading-[46px] text-[color:var(--color-pipeline-ink)]">
            Sign in to access Pipeline
          </h1>
          <p className="w-full font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-body)] leading-[var(--text-pipeline-body--line-height)] text-[color:var(--color-pipeline-ink-muted)]">
            Connect your wallet to unlock the dashboard, metrics, and deal
            activity.
          </p>
        </div>
      </div>

      {isUnauthorized && error ? (
        <div
          role="alert"
          data-testid="sign-in-error"
          className="w-full rounded-[var(--radius-pipeline-card)] border border-solid border-[color:var(--color-pipeline-negative)] bg-[rgba(192,57,43,0.06)] p-3 text-center font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-caption)] leading-[var(--text-pipeline-caption--line-height)] text-[color:var(--color-pipeline-ink)]"
        >
          {error}
        </div>
      ) : null}

      <div className="flex w-full flex-col items-start gap-3">
        <Button
          variant="primary-dark"
          // spec: docs/frontend/trustee-flows.md#sign-in-card-figma-node-417433891-frame-4174-31660-unauthenticated-overlay.
          className="!w-full !min-w-0 !rounded-[var(--radius-pipeline-pill)]"
          disabled={isConnecting}
          onClick={isUnauthorized ? signOut : signIn}
        >
          {isConnecting
            ? "Connecting…"
            : isUnauthorized
              ? "Try a different wallet"
              : "Connect Wallet"}
        </Button>
        <p className="w-full text-center font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-caption)] leading-[var(--text-pipeline-caption--line-height)] text-[color:var(--color-pipeline-ink-muted)]">
          No account? Contact your administrator.
        </p>
      </div>
    </div>
  );
}

export default SignInCard;
