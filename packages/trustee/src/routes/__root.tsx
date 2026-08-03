import { createRootRoute, redirect } from "@tanstack/react-router";
import { TrusteeShell } from "@/components/TrusteeShell";
import { TrusteeSessionProvider } from "@/auth/TrusteeSessionProvider";
import { getSessionState } from "@/auth/sessionStore";
import { resolveAuthRedirect } from "@/auth/authGate";
import { useAuthRedirect } from "@/auth/useAuthRedirect";

/**
 * Root layout — wraps every route with the Trustee session (auth) and topbar
 * (see TrusteeShell). `TrusteeSessionProvider` is mounted here (inside
 * `<RouterProvider>`), not in `main.tsx`, because it calls `useNavigate()`
 * for the sign-out redirect, which needs router context (#791).
 *
 * Auth gating runs in two race-free places, NOT a render-phase `<Navigate>`
 * (which raced React's commit in production and stranded the URL on `/sign-in`
 * with both the dashboard and the gate mounted, #921):
 *   - `beforeLoad` (below) guards every hard navigation in the router lifecycle.
 *   - `useAuthRedirect()` reacts to mid-session status changes (sign-in, sign-out,
 *     expiry) that `beforeLoad` can't see — the case the #988 `router.invalidate()`
 *     approach missed, which left `/sign-in` stranded after sign-in (#1008).
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
