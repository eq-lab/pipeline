import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Legacy-URL shim (#1008): the sign-in gate is no longer a route — it renders
 * as an overlay on the current URL (`TrusteeShell` → `SignInOverlay`). This
 * route exists only so stale `/sign-in` bookmarks and open tabs from before
 * the change land on `/` instead of a 404; the overlay shows there when the
 * visitor is unauthenticated.
 */
export const Route = createFileRoute("/sign-in")({
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
});
