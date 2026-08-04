/**
 * Pure auth-URL decision for the root `beforeLoad` guard: given session status
 * and pathname, where to redirect (or `null` to stay). URL convention only —
 * correctness is the render-level gate in TrusteeShell.
 *
 * spec: docs/frontend/trustee-flows.md#two-layer-gating-1008.
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
