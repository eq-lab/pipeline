/**
 * Tests for `useAuthRedirect` (#1008) — the reactive auth redirect for
 * mid-session status changes, plus the address-bar self-heal that re-stamps
 * `window.location` when an external history write desyncs it from router
 * state (the "Overview renders but the URL says /sign-in" staging bug).
 *
 * The router hooks are mocked (a captured `navigate` spy + controllable
 * pathname/href); the real session store drives `status`; the real
 * jsdom `window.history` receives the self-heal writes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  _resetSessionStoreForTests,
  setSession,
  setSessionStatus,
} from "./sessionStore";
import { useAuthRedirect } from "./useAuthRedirect";

const mockNavigate = vi.fn();
const mockRouter = { navigate: mockNavigate };
let currentPathname = "/";

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => mockRouter,
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: currentPathname, href: currentPathname } }),
}));

function authenticate() {
  setSession({
    token: "t",
    address: "0xabc",
    chainId: 1,
    expiresAt: Date.now() + 60_000,
  });
}

/** Put the real jsdom address bar at `path` (as an external write would). */
function setAddressBar(path: string) {
  window.history.replaceState(null, "", path);
}

beforeEach(() => {
  _resetSessionStoreForTests();
  mockNavigate.mockReset();
  currentPathname = "/";
  setAddressBar("/");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useAuthRedirect — semantic redirects", () => {
  it("redirects an authenticated session away from /sign-in to /", () => {
    currentPathname = "/sign-in";
    setAddressBar("/sign-in");
    authenticate();
    renderHook(() => useAuthRedirect());
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("redirects an unauthenticated session on a protected route to /sign-in", () => {
    currentPathname = "/loans";
    setAddressBar("/loans");
    renderHook(() => useAuthRedirect());
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/sign-in" });
  });

  it("does not redirect an authenticated session already on /", () => {
    authenticate();
    renderHook(() => useAuthRedirect());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("does not redirect an unauthenticated session already on /sign-in", () => {
    currentPathname = "/sign-in";
    setAddressBar("/sign-in");
    renderHook(() => useAuthRedirect());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("redirects to / the moment the session flips to authenticated on /sign-in (the bug)", () => {
    currentPathname = "/sign-in";
    setAddressBar("/sign-in");
    renderHook(() => useAuthRedirect());
    expect(mockNavigate).not.toHaveBeenCalled();

    act(() => authenticate());
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("redirects to /sign-in the moment the session is cleared on a protected route", () => {
    currentPathname = "/loans";
    setAddressBar("/loans");
    authenticate();
    renderHook(() => useAuthRedirect());
    expect(mockNavigate).not.toHaveBeenCalled();

    act(() => setSessionStatus("unauthenticated"));
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/sign-in" });
  });
});

describe("useAuthRedirect — address-bar self-heal (#1008 staging desync)", () => {
  it("re-stamps the address bar when it disagrees with router state (the screenshot bug)", () => {
    // Router (and rendered app) at "/", address bar clobbered to /sign-in.
    authenticate();
    setAddressBar("/sign-in");
    renderHook(() => useAuthRedirect());

    expect(window.location.pathname).toBe("/");
    // Router itself was NOT navigated — this is purely an address-bar fix.
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("catches a LATE clobber via the delayed re-checks", () => {
    vi.useFakeTimers();
    authenticate();
    renderHook(() => useAuthRedirect());
    expect(window.location.pathname).toBe("/");

    // External code rewrites the URL after the effect already ran
    // (e.g. the wallet modal restoring its pre-open URL on close).
    setAddressBar("/sign-in");
    act(() => {
      vi.runAllTimers();
    });
    expect(window.location.pathname).toBe("/");
  });

  it("leaves a matching address bar untouched", () => {
    authenticate();
    const spy = vi.spyOn(window.history, "replaceState");
    renderHook(() => useAuthRedirect());
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
