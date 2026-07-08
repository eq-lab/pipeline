import { createRootRoute } from "@tanstack/react-router";
import { TrusteeShell } from "@/components/TrusteeShell";
import { TrusteeSessionProvider } from "@/auth/TrusteeSessionProvider";

/**
 * Root layout — wraps every route with the Trustee session (auth) and topbar
 * (see TrusteeShell). `TrusteeSessionProvider` is mounted here (inside
 * `<RouterProvider>`), not in `main.tsx`, because it calls `useNavigate()`
 * for the sign-in/sign-out redirects, which needs router context (#791).
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
