import { createRootRoute, redirect } from "@tanstack/react-router";
import { TrusteeShell } from "@/components/TrusteeShell";
import { TrusteeSessionProvider } from "@/auth/TrusteeSessionProvider";
import { getSessionState } from "@/auth/sessionStore";
import { resolveAuthRedirect } from "@/auth/authGate";
import { useAuthRedirect } from "@/auth/useAuthRedirect";

/**
 * Root layout — wraps every route with the Trustee session (auth) and shell.
 *
 * Auth is enforced in two layers (#1008):
 *
 * 1. **Correctness — render-level gate** (`TrusteeShell`): while the session is
 *    not authenticated the shell renders the sign-in overlay and never mounts
 *    protected route content, regardless of URL. This layer cannot race — the
 *    stranded-`/sign-in` failures (#921/#988/#1009) can no longer show wrong
 *    or blank content even if a URL update misfires.
 * 2. **URL convention — redirects**: `/sign-in` is the canonical logged-out
 *    URL. `beforeLoad` (below) enforces it on hard navigations (unauth on a
 *    protected path → `/sign-in`; authenticated on `/sign-in` → `/`) and
 *    `useAuthRedirect()` enforces it on mid-session status changes (sign-in
 *    completing, sign-out, expiry). If either misfires, only the address bar
 *    is briefly wrong — layer 1 still shows the right content.
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
