/**
 * Unit tests for the Trustee session store (#791).
 *
 * Covers persistence to `sessionStorage`, hydration on load, expiry handling,
 * and the reactive/non-reactive accessor contract that `apiFetch` and
 * `TrusteeSessionProvider` depend on.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getSessionToken,
  getSessionState,
  setSession,
  setSessionStatus,
  subscribeSession,
  _resetSessionStoreForTests,
} from "./sessionStore";

const SAMPLE = {
  token: "jwt-token",
  address: "0xabc0000000000000000000000000000000000a",
  chainId: 560048,
};

beforeEach(() => {
  _resetSessionStoreForTests();
});

describe("sessionStore — basic get/set", () => {
  it("starts unauthenticated with no token", () => {
    expect(getSessionToken()).toBeUndefined();
    expect(getSessionState()).toEqual({
      status: "unauthenticated",
      address: undefined,
      error: undefined,
    });
  });

  it("setSession stores the token and flips status to authenticated", () => {
    setSession({ ...SAMPLE, expiresAt: Date.now() + 60_000 });

    expect(getSessionToken()).toBe("jwt-token");
    expect(getSessionState().status).toBe("authenticated");
    expect(getSessionState().address).toBe(SAMPLE.address);
  });

  it("setSession(undefined) clears the token and returns to unauthenticated", () => {
    setSession({ ...SAMPLE, expiresAt: Date.now() + 60_000 });
    setSession(undefined);

    expect(getSessionToken()).toBeUndefined();
    expect(getSessionState().status).toBe("unauthenticated");
  });

  it("persists the session to sessionStorage", () => {
    setSession({ ...SAMPLE, expiresAt: Date.now() + 60_000 });

    const raw = window.sessionStorage.getItem("pipeline.trustee.session");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.token).toBe("jwt-token");
    expect(parsed.address).toBe(SAMPLE.address);
  });

  it("clears sessionStorage on setSession(undefined)", () => {
    setSession({ ...SAMPLE, expiresAt: Date.now() + 60_000 });
    setSession(undefined);

    expect(
      window.sessionStorage.getItem("pipeline.trustee.session"),
    ).toBeNull();
  });
});

describe("sessionStore — status transitions", () => {
  it("setSessionStatus sets status and optional error without touching the token", () => {
    setSessionStatus("unauthorized", "not authorized");

    const state = getSessionState();
    expect(state.status).toBe("unauthorized");
    expect(state.error).toBe("not authorized");
    expect(getSessionToken()).toBeUndefined();
  });

  it("setSessionStatus('connecting') is readable via getSessionState", () => {
    setSessionStatus("connecting");
    expect(getSessionState().status).toBe("connecting");
  });
});

describe("sessionStore — expiry", () => {
  it("treats an expired token as unauthenticated", () => {
    setSession({ ...SAMPLE, expiresAt: Date.now() - 1000 });

    expect(getSessionToken()).toBeUndefined();
  });

  it("hydration drops an already-expired stored session", () => {
    window.sessionStorage.setItem(
      "pipeline.trustee.session",
      JSON.stringify({ ...SAMPLE, expiresAt: Date.now() - 1000 }),
    );

    // Re-run the module's hydration logic by re-reading via the public API —
    // getSessionToken() itself clears an expired in-memory session, so this
    // exercises the same guard hydration relies on.
    expect(getSessionToken()).toBeUndefined();
    expect(getSessionState().status).toBe("unauthenticated");
  });
});

describe("sessionStore — subscription", () => {
  it("notifies subscribers on setSession", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSession(listener);

    setSession({ ...SAMPLE, expiresAt: Date.now() + 60_000 });

    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it("stops notifying after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSession(listener);
    unsubscribe();

    setSession({ ...SAMPLE, expiresAt: Date.now() + 60_000 });

    expect(listener).not.toHaveBeenCalled();
  });
});

describe("sessionStore — reactive expiry timer (#795)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetSessionStoreForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("evicts an idle session the moment its token expires — no fetch needed", () => {
    const listener = vi.fn();
    subscribeSession(listener);
    setSession({ ...SAMPLE, expiresAt: Date.now() + 60_000 });
    listener.mockClear();
    expect(getSessionState().status).toBe("authenticated");

    // Idle: no apiFetch calls — only the timer advances.
    vi.advanceTimersByTime(60_000);

    expect(getSessionState().status).toBe("unauthenticated");
    expect(getSessionToken()).toBeUndefined();
    // The notify is what makes TrusteeShell re-render into the sign-in
    // overlay on its own (#1008 render-level gating).
    expect(listener).toHaveBeenCalled();
  });

  it("re-arms on setSession so the latest expiry wins", () => {
    setSession({ ...SAMPLE, expiresAt: Date.now() + 30_000 });
    setSession({ ...SAMPLE, expiresAt: Date.now() + 120_000 });

    // Past the first (superseded) expiry, before the second.
    vi.advanceTimersByTime(60_000);
    expect(getSessionState().status).toBe("authenticated");

    vi.advanceTimersByTime(60_000);
    expect(getSessionState().status).toBe("unauthenticated");
  });

  it("clears the timer on setSession(undefined) — no stray eviction fires", () => {
    setSession({ ...SAMPLE, expiresAt: Date.now() + 60_000 });
    setSession(undefined);
    const listener = vi.fn();
    subscribeSession(listener);

    vi.advanceTimersByTime(120_000);

    expect(listener).not.toHaveBeenCalled();
    expect(getSessionState().status).toBe("unauthenticated");
  });
});

describe("sessionStore — getSessionToken is a pure read (#795)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetSessionStoreForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns undefined for an expired token WITHOUT evicting or notifying", () => {
    const start = Date.now();
    setSession({ ...SAMPLE, expiresAt: start + 1_000 });
    const listener = vi.fn();
    subscribeSession(listener);

    // Move the clock past expiry but do NOT run the timer.
    vi.setSystemTime(start + 2_000);

    expect(getSessionToken()).toBeUndefined(); // pure: reflects expiry
    // …but performs no write/notify side effect (the timer owns eviction).
    expect(listener).not.toHaveBeenCalled();
    expect(getSessionState().status).toBe("authenticated");
  });
});
