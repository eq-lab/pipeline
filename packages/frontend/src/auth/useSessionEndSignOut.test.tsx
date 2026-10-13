// spec: docs/frontend/auth-components.md#session-module
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSessionEndSignOut } from "./useSessionEndSignOut";
import { saveSession, readSession } from "./session";

const { mockListeners, mockNavigate, mockShow, mockOpen } = vi.hoisted(() => ({
  mockListeners: new Set<(reason: string) => void>(),
  mockNavigate: vi.fn(),
  mockShow: vi.fn(),
  mockOpen: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@/api", () => ({
  subscribeSessionEnded: (listener: (reason: string) => void) => {
    mockListeners.add(listener);
    return () => {
      mockListeners.delete(listener);
    };
  },
}));

const mockToast = { show: mockShow, update: vi.fn(), dismiss: vi.fn() };
vi.mock("@/lib/toast", () => ({ useToast: () => mockToast }));

const mockAuthFlow = { open: mockOpen };
vi.mock("./AuthFlowContext", () => ({ useAuthFlow: () => mockAuthFlow }));

function publish(reason: string) {
  [...mockListeners].forEach((listener) => listener(reason));
}

const TOAST_TITLE = "Your session expired. Sign in again to continue.";

beforeEach(() => {
  localStorage.clear();
  mockListeners.clear();
  mockNavigate.mockClear();
  mockShow.mockClear();
  mockOpen.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useSessionEndSignOut — subscription", () => {
  it("clears a saved session and navigates home once on suspended", () => {
    saveSession({ token: "jwt", expires_in: 3600 });
    renderHook(() => useSessionEndSignOut());

    publish("suspended");

    expect(readSession()).toBeNull();
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/", replace: true });
  });

  it("signs out exactly once when two notifications fire back-to-back", () => {
    saveSession({ token: "jwt", expires_in: 3600 });
    renderHook(() => useSessionEndSignOut());

    publish("suspended");
    publish("suspended");

    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when there is no saved session", () => {
    renderHook(() => useSessionEndSignOut());

    publish("suspended");

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockShow).not.toHaveBeenCalled();
  });

  it("releases its subscription on unmount", () => {
    saveSession({ token: "jwt", expires_in: 3600 });
    const { unmount } = renderHook(() => useSessionEndSignOut());
    unmount();

    publish("suspended");

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("shows no toast on suspended", () => {
    saveSession({ token: "jwt", expires_in: 3600 });
    renderHook(() => useSessionEndSignOut());

    publish("suspended");

    expect(mockShow).not.toHaveBeenCalled();
  });

  it("on unauthorized clears, navigates once and shows the session-expired toast once", () => {
    saveSession({ token: "jwt", expires_in: 3600 });
    renderHook(() => useSessionEndSignOut());

    publish("unauthorized");
    publish("unauthorized");

    expect(readSession()).toBeNull();
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/", replace: true });
    expect(mockShow).toHaveBeenCalledTimes(1);
    const input = mockShow.mock.calls[0]![0];
    expect(input).toMatchObject({
      id: "session-expired",
      tone: "neutral",
      title: TOAST_TITLE,
      durationMs: 10000,
    });
    expect(input.action.label).toBe("Sign in");
    input.action.onClick();
    expect(mockOpen).toHaveBeenCalledWith("sign-in");
  });
});

describe("useSessionEndSignOut — expiry timer", () => {
  it("fires at expiresAt and shows the toast", () => {
    vi.useFakeTimers();
    saveSession({ token: "jwt", expires_in: 60 });
    renderHook(() => useSessionEndSignOut());

    act(() => {
      vi.advanceTimersByTime(59_999);
    });
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(readSession()).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(readSession()).toBeNull();
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/", replace: true });
    expect(mockShow).toHaveBeenCalledTimes(1);
    expect(mockShow.mock.calls[0]![0]).toMatchObject({
      id: "session-expired",
      title: TOAST_TITLE,
    });
  });

  it("re-arms on a new sign-in", () => {
    vi.useFakeTimers();
    saveSession({ token: "jwt1", expires_in: 60 });
    renderHook(() => useSessionEndSignOut());

    act(() => {
      saveSession({ token: "jwt2", expires_in: 120 });
    });
    act(() => {
      vi.advanceTimersByTime(61_000);
    });
    expect(mockNavigate).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(59_000);
    });
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockShow).toHaveBeenCalledTimes(1);
  });

  it("does nothing without a session", () => {
    vi.useFakeTimers();
    renderHook(() => useSessionEndSignOut());

    act(() => {
      vi.advanceTimersByTime(25 * 60 * 60 * 1000);
    });

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockShow).not.toHaveBeenCalled();
  });

  it("clears the timer on unmount", () => {
    vi.useFakeTimers();
    saveSession({ token: "jwt", expires_in: 60 });
    const { unmount } = renderHook(() => useSessionEndSignOut());
    unmount();

    act(() => {
      vi.advanceTimersByTime(120_000);
    });

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("does not arm above the setTimeout cap", () => {
    vi.useFakeTimers();
    saveSession({ token: "jwt", expires_in: 2 ** 31 / 1000 + 60 });
    renderHook(() => useSessionEndSignOut());

    act(() => {
      vi.advanceTimersByTime(1);
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(readSession()).not.toBeNull();
  });

  it("a 401 that clears the session cancels the pending timer", () => {
    vi.useFakeTimers();
    saveSession({ token: "jwt", expires_in: 60 });
    renderHook(() => useSessionEndSignOut());

    act(() => {
      publish("unauthorized");
    });
    act(() => {
      vi.advanceTimersByTime(120_000);
    });

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockShow).toHaveBeenCalledTimes(1);
  });
});
