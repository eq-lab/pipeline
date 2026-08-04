/**
 * Reactive auth-URL redirect for mid-session status changes (sign-in
 * completing, sign-out, token expiry) — the transitions the root `beforeLoad`
 * never sees because they happen without a navigation. URL convention only;
 * correctness is the render-level gate in TrusteeShell.
 *
 * spec: docs/frontend/trustee-flows.md#two-layer-gating-1008.
 */
import { useEffect } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { useSessionState } from "./sessionStore";
import { resolveAuthRedirect } from "./authGate";

export function useAuthRedirect(): void {
  const router = useRouter();
  const { status } = useSessionState();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    const to = resolveAuthRedirect(status, pathname);
    if (to && to !== pathname) void router.navigate({ to });
  }, [status, pathname, router]);
}
