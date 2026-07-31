import { useEffect } from "react";
import { createRootRoute, redirect, useRouter } from "@tanstack/react-router";
import { TrusteeShell } from "@/components/TrusteeShell";
import { TrusteeSessionProvider } from "@/auth/TrusteeSessionProvider";
import { getSessionState, subscribeSession } from "@/auth/sessionStore";
import { resolveAuthRedirect } from "@/auth/authGate";

/**
 * Root layout — wraps every route with the Trustee session (auth) and topbar
 * (see TrusteeShell). `TrusteeSessionProvider` is mounted here (inside
 * `<RouterProvider>`), not in `main.tsx`, because it calls `useNavigate()`
 * for the sign-out redirect, which needs router context (#791).
 *
 * Auth gating (redirect unauthenticated → `/sign-in`, authenticated on
 * `/sign-in` → `/`) runs in the router's `beforeLoad` (below), NOT a
 * render-phase `<Navigate>`. The render-phase redirect raced React's
 * render/commit in production builds and stranded the URL on `/sign-in` with
 * both the dashboard and the sign-in gate mounted (#921) — dev never showed it
 * because StrictMode's double-invoke masked the race. `beforeLoad` runs in the
 * router navigation lifecycle (race-free); `getSessionState()` is the non-hook
 * accessor built for exactly this. The `useEffect` re-runs the guard on every
 * session change (sign-in completes, sign-out, expiry) via `router.invalidate()`.
 */
function RootComponent() {
  const router = useRouter();
  useEffect(() => subscribeSession(() => void router.invalidate()), [router]);
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
