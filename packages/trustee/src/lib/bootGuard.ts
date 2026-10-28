// spec: docs/frontend/trustee-flows.md#app-bootstrap--providers
import { reportAppError } from "./diagnostics";

declare global {
  interface Window {
    __PIPELINE_BOOTED__?: boolean;
    __PIPELINE_URL_CANONICALISING__?: boolean;
  }
}

export function claimAppBoot(root: HTMLElement): boolean {
  if (window.__PIPELINE_URL_CANONICALISING__) return false;
  const booted = Boolean(window.__PIPELINE_BOOTED__);
  const reactContainer = Object.keys(root).some((k) =>
    k.startsWith("__reactContainer$"),
  );
  if (booted || reactContainer) {
    reportAppError("duplicate boot", undefined, undefined, {
      booted,
      reactContainer,
    });
    return false;
  }
  window.__PIPELINE_BOOTED__ = true;
  return true;
}
