/**
 * Auth-gate decision for the Trustee app (#791, hardened #921).
 *
 * Pure function used by the router's `beforeLoad` guard (`routes/__root.tsx`):
 * given the session status and the current path, it returns where to redirect,
 * or `null` to stay. Running the redirect in the router's navigation lifecycle
 * (`beforeLoad` + `router.invalidate()` on session change) is race-free, unlike
 * the previous render-phase `<Navigate>` component, which failed to settle the
 * router in production builds and stranded the URL on `/sign-in` with both the
 * dashboard and the sign-in gate mounted at once (#921 regression).
 *
 * Rules:
 *   - Not authenticated on a protected route → `/sign-in`.
 *   - Authenticated on `/sign-in` → `/` (no reason to re-show the gate).
 *   - Otherwise (incl. `connecting` / `unauthorized` on `/sign-in`, so the card
 *     can show its state/error) → `null`, stay put.
 */
import type { SessionStatus } from "./sessionStore";

export const SIGN_IN_PATH = "/sign-in";

export function resolveAuthRedirect(
  status: SessionStatus,
  pathname: string,
): "/" | "/sign-in" | null {
  const authenticated = status === "authenticated";
  const onSignIn = pathname === SIGN_IN_PATH;
  if (!authenticated && !onSignIn) return SIGN_IN_PATH;
  if (authenticated && onSignIn) return "/";
  return null;
}
