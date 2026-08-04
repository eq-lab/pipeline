import { createFileRoute } from "@tanstack/react-router";

/**
 * `/sign-in` — the canonical logged-out URL (#1008). The route renders nothing
 * itself: the sign-in UI is the render-level gate (`TrusteeShell` →
 * `SignInOverlay`), which shows whenever the session is unauthenticated —
 * on this URL or any other. Redirects keep the URL convention (`__root.tsx`):
 * signed-out visitors land here; an authenticated visitor here is sent to `/`.
 */
function SignIn() {
  // Only reachable in the brief window between authenticating on /sign-in and
  // the redirect to "/" — render nothing rather than flash stale gate UI.
  return null;
}

export const Route = createFileRoute("/sign-in")({
  component: SignIn,
});
