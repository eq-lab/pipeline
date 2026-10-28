// spec: docs/frontend/trustee-flows.md#app-bootstrap--providers
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { installGlobalErrorReporting } from "./diagnostics";

const router = {
  state: { location: { pathname: "/loans" }, status: "pending" },
  latestLocation: { pathname: "/sign-in" },
} as unknown as Parameters<typeof installGlobalErrorReporting>[0];

let consoleError: ReturnType<typeof vi.spyOn>;
let cleanup: () => void;
const reload = vi.fn();
const originalLocation = window.location;

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  window.sessionStorage.clear();
  reload.mockReset();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...originalLocation, href: "http://localhost/loans", reload },
  });
  cleanup = installGlobalErrorReporting(router);
});

afterEach(() => {
  cleanup();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
  vi.restoreAllMocks();
});

function rejection(reason: unknown) {
  const event = new Event("unhandledrejection");
  Object.assign(event, { reason });
  return event;
}

describe("installGlobalErrorReporting", () => {
  it("logs an unhandled rejection of undefined with router state and href", () => {
    window.dispatchEvent(rejection(undefined));
    expect(consoleError).toHaveBeenCalledWith(
      "[trustee] unhandledrejection",
      expect.objectContaining({
        type: "undefined",
        routerPathname: "/loans",
        routerStatus: "pending",
        pendingPathname: "/sign-in",
        href: "http://localhost/loans",
      }),
    );
  });

  it("logs a window error event", () => {
    const err = new Error("kaboom");
    window.dispatchEvent(new ErrorEvent("error", { error: err }));
    expect(consoleError).toHaveBeenCalledWith(
      "[trustee] window.error",
      expect.objectContaining({ value: err, message: "kaboom" }),
    );
  });

  it("reloads once on vite:preloadError and logs a repeat within 10 s", () => {
    const first = new Event("vite:preloadError", { cancelable: true });
    window.dispatchEvent(first);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(first.defaultPrevented).toBe(true);

    window.dispatchEvent(new Event("vite:preloadError", { cancelable: true }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      "[trustee] preloadError",
      expect.any(Object),
    );
  });

  it("reloads again once the guard window has passed", () => {
    window.sessionStorage.setItem(
      "pipeline.trustee.preloadReloadAt",
      String(Date.now() - 11_000),
    );
    window.dispatchEvent(new Event("vite:preloadError", { cancelable: true }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("cleanup removes the listeners", () => {
    cleanup();
    window.dispatchEvent(rejection(undefined));
    window.dispatchEvent(new Event("vite:preloadError", { cancelable: true }));
    expect(consoleError).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    cleanup = installGlobalErrorReporting(router);
  });
});
