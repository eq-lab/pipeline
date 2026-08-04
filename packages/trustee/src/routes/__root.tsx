import { createRootRoute } from "@tanstack/react-router";
import { TrusteeShell } from "@/components/TrusteeShell";
import { TrusteeSessionProvider } from "@/auth/TrusteeSessionProvider";

/**
 * Root layout — wraps every route with the Trustee session (auth) and shell.
 *
 * Auth gating is render-level in `TrusteeShell` (#1008): unauthenticated →
 * the sign-in overlay on the current URL; authenticated → the app. There is
 * deliberately NO route-level auth redirect here — the previous URL-based
 * gate (`/sign-in` + `beforeLoad`/`invalidate`/reactive-navigate, #921/#988/
 * #1009) repeatedly stranded the URL on `/sign-in` in production. With no
 * auth URL there is nothing to strand.
 */
function RootComponent() {
  return (
    <TrusteeSessionProvider>
      <TrusteeShell />
    </TrusteeSessionProvider>
  );
}

export const Route = createRootRoute({
  component: RootComponent,
});
