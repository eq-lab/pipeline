// spec: docs/FRONTEND.md#page-url-canonicalisation-and-boot-guard
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
    console.error("[pipeline] duplicate boot", {
      href: window.location.href,
      booted,
      reactContainer,
    });
    return false;
  }
  window.__PIPELINE_BOOTED__ = true;
  return true;
}
