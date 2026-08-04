import { Outlet } from "@tanstack/react-router";
import { TrusteeSidebar } from "@/components/TrusteeSidebar";
import { SignInOverlay } from "@/components/SignInOverlay";
import { useTrusteeSession } from "@/auth/TrusteeSessionProvider";

/**
 * TrusteeShell — root layout (Figma `4116:8855`, #786): sidebar + route
 * outlet when authenticated; the sign-in overlay otherwise. This render-level
 * branch IS the auth gate — protected content never mounts signed out, and no
 * URL race can strand wrong content (#1008). Plain `<div>` wrapper: routes own
 * their own `<main>` landmark.
 *
 * spec: docs/frontend/trustee-flows.md#two-layer-gating-1008.
 */
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
