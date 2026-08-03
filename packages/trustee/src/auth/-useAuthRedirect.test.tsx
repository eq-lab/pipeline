/**
 * Tests for `useAuthRedirect` (#1008) — the reactive auth redirect that fixes
 * the URL being stranded on `/sign-in` after a successful sign-in.
 *
 * The router hooks are mocked (a captured `navigate` spy + a controllable
 * pathname); the real session store drives `status`, so the test exercises the
 * actual store → effect → navigate path.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
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
    select({ location: { pathname: currentPathname } }),
}));

function authenticate() {
  setSession({
    token: "t",
    address: "0xabc",
    chainId: 1,
    expiresAt: Date.now() + 60_000,
  });
}

beforeEach(() => {
  _resetSessionStoreForTests();
  mockNavigate.mockReset();
  currentPathname = "/";
});

describe("useAuthRedirect", () => {
  it("redirects an authenticated session away from /sign-in to /", () => {
    currentPathname = "/sign-in";
    authenticate();
    renderHook(() => useAuthRedirect());
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("redirects an unauthenticated session on a protected route to /sign-in", () => {
    currentPathname = "/loans";
    renderHook(() => useAuthRedirect());
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/sign-in" });
  });

  it("does not redirect an authenticated session already on /", () => {
    currentPathname = "/";
    authenticate();
    renderHook(() => useAuthRedirect());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("does not redirect an unauthenticated session already on /sign-in", () => {
    currentPathname = "/sign-in";
    renderHook(() => useAuthRedirect());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("redirects to / the moment the session flips to authenticated on /sign-in (the bug)", () => {
    currentPathname = "/sign-in";
    // Start unauthenticated on /sign-in — no redirect yet.
    renderHook(() => useAuthRedirect());
    expect(mockNavigate).not.toHaveBeenCalled();

    // Sign-in completes mid-session → the effect must navigate to /.
    act(() => authenticate());
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("redirects to /sign-in the moment the session is cleared on a protected route", () => {
    currentPathname = "/loans";
    authenticate();
    renderHook(() => useAuthRedirect());
    expect(mockNavigate).not.toHaveBeenCalled();

    // Sign-out / expiry mid-session → navigate to the gate.
    act(() => setSessionStatus("unauthenticated"));
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/sign-in" });
  });
});
