// spec: docs/frontend/trustee-flows.md#app-bootstrap--providers
import type { AnyRouter } from "@tanstack/react-router";

const PRELOAD_RELOAD_KEY = "pipeline.trustee.preloadReloadAt";
const PRELOAD_RELOAD_GUARD_MS = 10_000;

type RouterLike = Pick<AnyRouter, "state" | "latestLocation">;

export function reportAppError(
  source: string,
  value: unknown,
  router?: RouterLike,
  extra?: unknown,
): void {
  const asError = value instanceof Error ? value : undefined;
  console.error(`[trustee] ${source}`, {
    value,
    type: typeof value,
    message: asError?.message,
    stack: asError?.stack,
    routerPathname: router?.state.location.pathname,
    routerStatus: router?.state.status,
    pendingPathname: router?.latestLocation.pathname,
    href: window.location.href,
    extra,
  });
}

function shouldReloadForPreloadError(): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(PRELOAD_RELOAD_KEY));
    if (last && Date.now() - last < PRELOAD_RELOAD_GUARD_MS) return false;
    window.sessionStorage.setItem(PRELOAD_RELOAD_KEY, String(Date.now()));
  } catch {
    return false;
  }
  return true;
}

export function installGlobalErrorReporting(router?: RouterLike): () => void {
  const onError = (e: ErrorEvent) =>
    reportAppError("window.error", e.error ?? e.message, router);
  const onRejection = (e: PromiseRejectionEvent) =>
    reportAppError("unhandledrejection", e.reason, router);
  const onPreloadError = (e: Event) => {
    if (shouldReloadForPreloadError()) {
      e.preventDefault();
      window.location.reload();
      return;
    }
    reportAppError(
      "preloadError",
      (e as Event & { payload?: unknown }).payload,
      router,
    );
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  window.addEventListener("vite:preloadError", onPreloadError);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    window.removeEventListener("vite:preloadError", onPreloadError);
  };
}
