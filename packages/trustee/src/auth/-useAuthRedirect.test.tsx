// spec: docs/frontend/trustee-flows.md#two-layer-gating-1008
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  _resetSessionStoreForTests,
  setSession,
  setSessionStatus,
} from "./sessionStore";
import { useAuthRedirect } from "./useAuthRedirect";

const mockNavigate = vi.fn();
let currentPathname = "/";
let latestPathname = "/";
let routerStatus: "idle" | "pending" = "idle";
const mockRouter = {
  navigate: mockNavigate,
  get latestLocation() {
    return { pathname: latestPathname };
  },
  get state() {
    return {
      status: routerStatus,
      location: { pathname: currentPathname },
      isTransitioning: false,
      resolvedLocation: { pathname: currentPathname, href: currentPathname },
    };
  },
};

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => mockRouter,
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: currentPathname, href: currentPathname } }),
}));

function setPath(path: string) {
  currentPathname = path;
  latestPathname = path;
  setAddressBar(path);
}

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
  mockNavigate.mockResolvedValue(undefined);
  currentPathname = "/";
  latestPathname = "/";
  routerStatus = "idle";
  setAddressBar("/");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useAuthRedirect — semantic redirects", () => {
  it("redirects an authenticated session away from /sign-in to /", () => {
    setPath("/sign-in");
    authenticate();
    renderHook(() => useAuthRedirect());
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/", replace: true });
  });

  it("redirects an unauthenticated session on a protected route to /sign-in", () => {
    setPath("/loans");
    renderHook(() => useAuthRedirect());
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/sign-in",
      replace: true,
    });
  });

  it("does not redirect an authenticated session already on /", () => {
    authenticate();
    renderHook(() => useAuthRedirect());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("does not redirect an unauthenticated session already on /sign-in", () => {
    setPath("/sign-in");
    renderHook(() => useAuthRedirect());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("redirects to / the moment the session flips to authenticated on /sign-in (the bug)", () => {
    setPath("/sign-in");
    renderHook(() => useAuthRedirect());
    expect(mockNavigate).not.toHaveBeenCalled();

    act(() => authenticate());
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/", replace: true });
  });

  it("redirects to /sign-in the moment the session is cleared on a protected route", () => {
    setPath("/loans");
    authenticate();
    renderHook(() => useAuthRedirect());
    expect(mockNavigate).not.toHaveBeenCalled();

    act(() => setSessionStatus("unauthenticated"));
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/sign-in",
      replace: true,
    });
  });
});

describe("useAuthRedirect — address-bar self-heal (#1008 staging desync)", () => {
  it("re-stamps the address bar when it disagrees with router state (the screenshot bug)", () => {
    authenticate();
    setAddressBar("/sign-in");
    renderHook(() => useAuthRedirect());

    expect(window.location.pathname).toBe("/");
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("catches a LATE clobber via the delayed re-checks", () => {
    vi.useFakeTimers();
    authenticate();
    renderHook(() => useAuthRedirect());
    expect(window.location.pathname).toBe("/");

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

describe("useAuthRedirect — single owner", () => {
  it("does not navigate when the target is already the latest location", () => {
    currentPathname = "/loans";
    latestPathname = "/sign-in";
    renderHook(() => useAuthRedirect());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("does not issue a second navigation to a target already in flight", () => {
    mockNavigate.mockReturnValue(new Promise(() => {}));
    setPath("/loans");
    const { rerender } = renderHook(() => useAuthRedirect());
    rerender();
    act(() => setSessionStatus("connecting"));
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  it("reports a rejected navigation instead of swallowing it", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockNavigate.mockRejectedValue(undefined);
    setPath("/loans");
    renderHook(() => useAuthRedirect());
    await act(async () => {
      await Promise.resolve();
    });
    expect(spy).toHaveBeenCalledWith(
      "[trustee] auth-redirect",
      expect.objectContaining({ type: "undefined" }),
    );
    spy.mockRestore();
  });
});

describe("useAuthRedirect — self-heal gating", () => {
  it("does not touch history while the router is pending, then heals once idle", () => {
    vi.useFakeTimers();
    authenticate();
    setAddressBar("/sign-in");
    routerStatus = "pending";
    renderHook(() => useAuthRedirect());
    expect(window.location.pathname).toBe("/sign-in");

    routerStatus = "idle";
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(window.location.pathname).toBe("/");
  });
});
