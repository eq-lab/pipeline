import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAuthSession } from "./useAuthSession";
import { saveSession } from "./session";

beforeEach(() => {
  localStorage.clear();
});

describe("useAuthSession", () => {
  it("reports unauthenticated with no stored session", () => {
    const { result } = renderHook(() => useAuthSession());
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.token).toBeUndefined();
  });

  it("reports authenticated once a session is saved, reactively", () => {
    const { result } = renderHook(() => useAuthSession());
    expect(result.current.isAuthenticated).toBe(false);

    act(() => {
      saveSession({ token: "jwt", expires_in: 86400 });
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.token).toBe("jwt");
    expect(result.current.expiresAt).toBeDefined();
  });

  it("signOut clears the session and flips isAuthenticated back to false", () => {
    saveSession({ token: "jwt", expires_in: 86400 });
    const { result } = renderHook(() => useAuthSession());
    expect(result.current.isAuthenticated).toBe(true);

    act(() => {
      result.current.signOut();
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.token).toBeUndefined();
  });
});
