// spec: docs/frontend/ui-components.md#usecopytoclipboard
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCopyToClipboard } from "@pipeline/ui";

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    get: () => value,
  });
}

describe("useCopyToClipboard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    setClipboard(undefined);
    Reflect.deleteProperty(document, "execCommand");
  });

  it("sets copied then resets after 1500 ms", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    const { result } = renderHook(() => useCopyToClipboard());

    let ok = false;
    await act(async () => {
      ok = await result.current.copy("abc");
    });
    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith("abc");
    expect(result.current.copied).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1499);
    });
    expect(result.current.copied).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.copied).toBe(false);
  });

  it("returns false without throwing when clipboard and execCommand are absent", async () => {
    setClipboard(undefined);
    const { result } = renderHook(() => useCopyToClipboard());
    let ok = true;
    await act(async () => {
      ok = await result.current.copy("abc");
    });
    expect(ok).toBe(false);
    expect(result.current.copied).toBe(false);
  });

  it("returns false when writeText rejects and no fallback succeeds", async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error("no")) });
    const { result } = renderHook(() => useCopyToClipboard());
    let ok = true;
    await act(async () => {
      ok = await result.current.copy("abc");
    });
    expect(ok).toBe(false);
    expect(result.current.copied).toBe(false);
  });

  it("falls back to execCommand when navigator.clipboard is missing", async () => {
    setClipboard(undefined);
    const exec = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: exec,
    });
    const { result } = renderHook(() => useCopyToClipboard());
    await act(async () => {
      await result.current.copy("abc");
    });
    expect(exec).toHaveBeenCalledWith("copy");
    expect(result.current.copied).toBe(true);
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("honours a custom reset and clears the timer on unmount", async () => {
    setClipboard({ writeText: vi.fn().mockResolvedValue(undefined) });
    const { result, unmount } = renderHook(() => useCopyToClipboard(1600));
    await act(async () => {
      await result.current.copy("abc");
    });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
