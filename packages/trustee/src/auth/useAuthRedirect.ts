// spec: docs/frontend/trustee-flows.md#two-layer-gating-1008
import { useEffect, useRef } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { reportAppError } from "@/lib/diagnostics";
import { useSessionState } from "./sessionStore";
import { resolveAuthRedirect } from "./authGate";

const URL_SYNC_RECHECK_MS = [250, 1500];

export function useAuthRedirect(): void {
  const router = useRouter();
  const { status } = useSessionState();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const inFlightRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const to = resolveAuthRedirect(status, pathname);
    if (to) {
      if (router.latestLocation.pathname === to) return;
      if (inFlightRef.current === to) return;
      inFlightRef.current = to;
      router
        .navigate({ to, replace: true })
        .catch((err: unknown) => reportAppError("auth-redirect", err, router))
        .finally(() => {
          if (inFlightRef.current === to) inFlightRef.current = undefined;
        });
      return;
    }

    const sync = () => {
      const {
        status: routerStatus,
        isTransitioning,
        resolvedLocation,
      } = router.state;
      if (routerStatus !== "idle" || isTransitioning || !resolvedLocation)
        return;
      if (router.latestLocation.pathname !== resolvedLocation.pathname) return;
      if (window.location.pathname !== resolvedLocation.pathname) {
        window.history.replaceState(
          window.history.state,
          "",
          resolvedLocation.href,
        );
      }
    };
    sync();
    const timers = URL_SYNC_RECHECK_MS.map((ms) => setTimeout(sync, ms));
    return () => timers.forEach(clearTimeout);
  }, [status, pathname, router]);
}
