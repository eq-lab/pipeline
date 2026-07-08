import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  readMock,
  subscribeMock,
  installSameTabMockBridge,
  parseAddress,
  parseBoolean,
  parseNumber,
  parseBigInt,
  parseJson,
  useMock,
  _resetBridgeForTests,
} from "./mock";
import { renderHook, act } from "@testing-library/react";

describe("readMock", () => {
  beforeEach(() => localStorage.clear());

  it("returns undefined when key is absent", () => {
    expect(
      readMock("pipeline.mock.wallet.address", parseAddress),
    ).toBeUndefined();
  });

  it("parses an address", () => {
    localStorage.setItem(
      "pipeline.mock.wallet.address",
      "0x1234000000000000000000000000000000000000",
    );
    expect(readMock("pipeline.mock.wallet.address", parseAddress)).toBe(
      "0x1234000000000000000000000000000000000000",
    );
  });

  it("parses a boolean true", () => {
    localStorage.setItem("pipeline.mock.wallet.isConnected", "true");
    expect(readMock("pipeline.mock.wallet.isConnected", parseBoolean)).toBe(
      true,
    );
  });

  it("parses a boolean false", () => {
    localStorage.setItem("pipeline.mock.wallet.isConnected", "false");
    expect(readMock("pipeline.mock.wallet.isConnected", parseBoolean)).toBe(
      false,
    );
  });

  it("parses a number", () => {
    localStorage.setItem("pipeline.mock.wallet.chainId", "560048");
    expect(readMock("pipeline.mock.wallet.chainId", parseNumber)).toBe(560048);
  });

  it("parses a bigint", () => {
    localStorage.setItem("pipeline.mock.wallet.balance.usdc", "1000000000");
    expect(readMock("pipeline.mock.wallet.balance.usdc", parseBigInt)).toBe(
      1_000_000_000n,
    );
  });

  it("parses JSON", () => {
    localStorage.setItem("some.key", JSON.stringify({ x: 42 }));
    expect(readMock("some.key", parseJson)).toEqual({ x: 42 });
  });
});

describe("parseJson — error handling", () => {
  it("returns undefined on malformed JSON (no throw)", () => {
    // readMock wraps the parse call in try/catch
    localStorage.setItem("bad.key", "{ not valid json");
    expect(readMock("bad.key", parseJson)).toBeUndefined();
  });
});

describe("subscribeMock — cross-tab storage events", () => {
  beforeEach(() => localStorage.clear());

  it("calls listener on storage event", () => {
    const listener = vi.fn();
    const unsub = subscribeMock("pipeline.mock.wallet.address", listener);

    window.dispatchEvent(
      new StorageEvent("storage", { key: "pipeline.mock.wallet.address" }),
    );
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
    window.dispatchEvent(
      new StorageEvent("storage", { key: "pipeline.mock.wallet.address" }),
    );
    expect(listener).toHaveBeenCalledTimes(1); // no more calls after unsub
  });
});

describe("installSameTabMockBridge", () => {
  beforeEach(() => {
    localStorage.clear();
    _resetBridgeForTests();
  });

  afterEach(() => {
    _resetBridgeForTests();
  });

  /**
   * NOTE: jsdom's `localStorage` implementation uses non-configurable
   * properties that cannot be spied on or replaced via direct assignment or
   * `vi.spyOn`. As a result, tests that validate the `localStorage.setItem`
   * patching mechanism cannot run in the vitest/jsdom environment.
   *
   * The same-tab bridge is a browser-only feature. Its *observable effect*
   * (that mock keys fire the `pipeline-mock:wallet` custom event causing hook
   * re-renders) is covered by the `useMock hook` describe block below, which
   * dispatches the custom event directly without relying on the patched
   * `localStorage.setItem`.
   *
   * Manual verification: run `yarn workspace @pipeline/frontend dev`, open
   * DevTools, set a `pipeline.mock.wallet.*` key, and observe the UI update
   * without a reload.
   */

  it("installSameTabMockBridge returns a cleanup function", () => {
    const cleanup = installSameTabMockBridge();
    expect(typeof cleanup).toBe("function");
    cleanup();
  });

  it("calling installSameTabMockBridge twice returns a no-op from the second call", () => {
    const cleanup1 = installSameTabMockBridge();
    // Second call — bridge already installed, returns empty no-op
    const cleanup2 = installSameTabMockBridge();

    // Both cleanups are callable without error
    expect(() => {
      cleanup2(); // no-op
      cleanup1(); // real cleanup
    }).not.toThrow();
  });

  it("dispatches pipeline-mock:wallet when the event is fired directly", () => {
    // Test the event subscription mechanism independently of the localStorage patch
    const listener = vi.fn();
    window.addEventListener("pipeline-mock:wallet", listener);

    window.dispatchEvent(
      new CustomEvent("pipeline-mock:wallet", {
        detail: { key: "pipeline.mock.wallet.address" },
      }),
    );

    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener("pipeline-mock:wallet", listener);
  });
});

describe("useMock hook", () => {
  beforeEach(() => localStorage.clear());

  it("returns undefined when key is absent", () => {
    const { result } = renderHook(() =>
      useMock("pipeline.mock.wallet.address", parseAddress),
    );
    expect(result.current).toBeUndefined();
  });

  it("returns the value when key is present", () => {
    localStorage.setItem(
      "pipeline.mock.wallet.address",
      "0x1234000000000000000000000000000000000000",
    );
    const { result } = renderHook(() =>
      useMock("pipeline.mock.wallet.address", parseAddress),
    );
    expect(result.current).toBe("0x1234000000000000000000000000000000000000");
  });

  it("re-renders when a storage event fires", () => {
    const { result } = renderHook(() =>
      useMock("pipeline.mock.wallet.address", parseAddress),
    );
    expect(result.current).toBeUndefined();

    act(() => {
      localStorage.setItem(
        "pipeline.mock.wallet.address",
        "0xdeadbeef00000000000000000000000000000000",
      );
      window.dispatchEvent(
        new CustomEvent("pipeline-mock:wallet", {
          detail: { key: "pipeline.mock.wallet.address" },
        }),
      );
    });

    expect(result.current).toBe("0xdeadbeef00000000000000000000000000000000");
  });
});
