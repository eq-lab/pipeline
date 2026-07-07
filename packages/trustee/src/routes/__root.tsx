import { createRootRoute } from "@tanstack/react-router";
import { TrusteeShell } from "@/components/TrusteeShell";

/**
 * Root layout — wraps every route with the Trustee topbar (see TrusteeShell).
 */
export const Route = createRootRoute({
  component: TrusteeShell,
});
