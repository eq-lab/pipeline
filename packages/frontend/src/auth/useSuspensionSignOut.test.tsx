// spec: docs/frontend/auth-components.md#session-module
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSuspensionSignOut } from "./useSuspensionSignOut";
import { saveSession, readSession } from "./session";

const { mockListeners, mockNavigate } = vi.hoisted(() => ({
  mockListeners: new Set<() => void>(),
  mockNavigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@/api", () => ({
  subscribeAccountSuspended: (listener: () => void) => {
    mockListeners.add(listener);
    return () => {
      mockListeners.delete(listener);
    };
  },
}));

function notifyAccountSuspended() {
  [...mockListeners].forEach((listener) => listener());
}

beforeEach(() => {
  localStorage.clear();
  mockListeners.clear();
  mockNavigate.mockClear();
});

describe("useSuspensionSignOut", () => {
  it("clears a saved session and navigates home once on notification", () => {
    saveSession({ token: "jwt", expires_in: 3600 });
    renderHook(() => useSuspensionSignOut());

    notifyAccountSuspended();

    expect(readSession()).toBeNull();
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/", replace: true });
  });

  it("signs out exactly once when two notifications fire back-to-back", () => {
    saveSession({ token: "jwt", expires_in: 3600 });
    renderHook(() => useSuspensionSignOut());

    notifyAccountSuspended();
    notifyAccountSuspended();

    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when there is no saved session", () => {
    renderHook(() => useSuspensionSignOut());

    notifyAccountSuspended();

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("releases its subscription on unmount", () => {
    saveSession({ token: "jwt", expires_in: 3600 });
    const { unmount } = renderHook(() => useSuspensionSignOut());
    unmount();

    notifyAccountSuspended();

    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
