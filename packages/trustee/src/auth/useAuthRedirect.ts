/**
 * Reactive auth redirect for the Trustee app (#1008).
 *
 * The root route's `beforeLoad` guard (`routes/__root.tsx`) covers hard
 * navigations, but it does NOT re-run on a **mid-session** status change
 * (sign-in completing, sign-out, token expiry) — and `router.invalidate()`
 * (the #988 approach) does not reliably re-run the root `beforeLoad`'s redirect
 * in production, which stranded the URL on `/sign-in` after a successful
 * sign-in. This hook closes that gap: it reacts to the committed session
 * `status` + current pathname and navigates imperatively.
 *
 * Being a post-commit effect keyed on committed state, it avoids the
 * render-phase `<Navigate>` / in-flow `navigate()` races that #921 removed.
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
