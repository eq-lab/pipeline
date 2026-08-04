import { createRootRoute, redirect } from "@tanstack/react-router";
import { TrusteeShell } from "@/components/TrusteeShell";
import { TrusteeSessionProvider } from "@/auth/TrusteeSessionProvider";
import { getSessionState } from "@/auth/sessionStore";
import { resolveAuthRedirect } from "@/auth/authGate";
import { useAuthRedirect } from "@/auth/useAuthRedirect";

/**
 * Root layout — session provider + shell, plus the auth-URL redirects
 * (`beforeLoad` for hard navigations, `useAuthRedirect` for mid-session
 * changes). Correctness is the render-level gate in TrusteeShell; these
 * redirects only keep the /sign-in ↔ / URL convention.
 *
 * spec: docs/frontend/trustee-flows.md#two-layer-gating-1008.
 */
function RootComponent() {
  useAuthRedirect();
  return (
    <TrusteeSessionProvider>
      <TrusteeShell />
    </TrusteeSessionProvider>
  );
}

export const Route = createRootRoute({
  beforeLoad: ({ location }) => {
    const to = resolveAuthRedirect(getSessionState().status, location.pathname);
    if (to) throw redirect({ to });
  },
  component: RootComponent,
});
