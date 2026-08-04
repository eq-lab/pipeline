/**
 * Reactive auth-URL redirect for mid-session status changes (sign-in
 * completing, sign-out, token expiry) — the transitions the root `beforeLoad`
 * never sees because they happen without a navigation. Also self-heals the
 * address bar when it desyncs from router state. URL convention only;
 * correctness is the render-level gate in TrusteeShell.
 *
 * spec: docs/frontend/trustee-flows.md#two-layer-gating-1008.
 */
import { useEffect } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { useSessionState } from "./sessionStore";
import { resolveAuthRedirect } from "./authGate";

/** Late re-check delays for the address-bar sync (see effect body). */
const URL_SYNC_RECHECK_MS = [250, 1500];

export function useAuthRedirect(): void {
  const router = useRouter();
  const { status } = useSessionState();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const href = useRouterState({ select: (s) => s.location.href });

  useEffect(() => {
    const to = resolveAuthRedirect(status, pathname);
    if (to && to !== pathname) {
      void router.navigate({ to });
      return;
    }

    // Address-bar self-heal (#1008, observed on staging): external history
    // writes (e.g. the wallet modal restoring its pre-open URL on close) can
    // overwrite the address bar WITHOUT the router noticing — window.location
    // then shows /sign-in while the router (and the rendered app) sit on "/".
    // No router/React state reflects that divergence, so it must be checked
    // against window.location directly. Router state is the source of truth:
    // re-stamp the address bar whenever the pathname disagrees. Re-check
    // shortly after, because the clobber can land later than this effect
    // (modal close animation).
    const sync = () => {
      if (window.location.pathname !== pathname) {
        window.history.replaceState(window.history.state, "", href);
      }
    };
    sync();
    const timers = URL_SYNC_RECHECK_MS.map((ms) => setTimeout(sync, ms));
    return () => timers.forEach(clearTimeout);
  }, [status, pathname, href, router]);
}
