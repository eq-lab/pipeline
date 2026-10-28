// spec: docs/frontend/trustee-flows.md#render-level-auth-gate-1008-1749
import { Outlet } from "@tanstack/react-router";
import { TrusteeSidebar } from "@/components/TrusteeSidebar";
import { SignInOverlay } from "@/components/SignInOverlay";
import { useTrusteeSession } from "@/auth/TrusteeSessionProvider";

export function TrusteeShell() {
  const { status } = useTrusteeSession();
  const isAuthenticated = status === "authenticated";

  if (!isAuthenticated) {
    return <SignInOverlay />;
  }

  return (
    <div className="flex min-h-screen bg-[var(--color-pipeline-paper)] text-[color:var(--color-pipeline-ink)]">
      <TrusteeSidebar />
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
