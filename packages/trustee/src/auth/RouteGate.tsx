/**
 * RouteGate — route-level auth gating for the Trustee app (#791).
 *
 * Renders one of three things based on `useTrusteeSession().status` and the
 * current path:
 *   - Unauthenticated (or unauthorized / connecting) on a protected route →
 *     redirect to `/sign-in`.
 *   - Authenticated on `/sign-in` → redirect to `/` (no reason to re-show the
 *     sign-in card once a session exists).
 *   - Otherwise → render the route's `<Outlet/>` normally.
 *
 * Mounted inside `TrusteeShell` (`__root.tsx` → `TrusteeSessionProvider` →
 * `TrusteeShell`), which decides whether to render its topbar nav based on
 * the same session status (hidden while unauthenticated, per the exec plan's
 * note about `/sign-in` rendering standalone).
 */
import { Navigate, Outlet, useLocation } from "@tanstack/react-router";
import { useTrusteeSession } from "./TrusteeSessionProvider";

const SIGN_IN_PATH = "/sign-in";

export function RouteGate() {
  const { status } = useTrusteeSession();
  const location = useLocation();
  const isSignInRoute = location.pathname === SIGN_IN_PATH;
  const isAuthenticated = status === "authenticated";

  if (!isAuthenticated && !isSignInRoute) {
    return <Navigate to={SIGN_IN_PATH} replace />;
  }

  if (isAuthenticated && isSignInRoute) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
