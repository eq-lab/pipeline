import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useTermsAcknowledgement,
  readTermsAcknowledged,
} from "./useTermsAcknowledgement";

const ADDR = "0xABCDEF0000000000000000000000000000000001";
const ADDR_LOWER = ADDR.toLowerCase();
const ACK_KEY = `pipeline.wallet.termsAcknowledged.${ADDR_LOWER}`;
const PENDING_KEY = "pipeline.wallet.termsAcknowledged.pending";

describe("readTermsAcknowledged — synchronous helper", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("returns false when localStorage key is absent", () => {
    expect(readTermsAcknowledged(ADDR)).toBe(false);
  });

  it("returns true when address-scoped key is 'true'", () => {
    localStorage.setItem(ACK_KEY, "true");
    expect(readTermsAcknowledged(ADDR)).toBe(true);
  });

  it("returns false when address-scoped key is some other value", () => {
    localStorage.setItem(ACK_KEY, "yes");
    expect(readTermsAcknowledged(ADDR)).toBe(false);
  });

  it("returns false when address is undefined and pending key is absent", () => {
    expect(readTermsAcknowledged(undefined)).toBe(false);
  });

  it("returns true when address is undefined and pending key is 'true'", () => {
    localStorage.setItem(PENDING_KEY, "true");
    expect(readTermsAcknowledged(undefined)).toBe(true);
  });

  it("is case-insensitive (normalises address to lowercase)", () => {
    localStorage.setItem(ACK_KEY, "true");
    expect(readTermsAcknowledged(ADDR.toUpperCase())).toBe(true);
    expect(readTermsAcknowledged(ADDR.toLowerCase())).toBe(true);
  });
});

describe("useTermsAcknowledgement — hook", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("returns acknowledged: false by default", () => {
    const { result } = renderHook(() => useTermsAcknowledgement(ADDR));
    expect(result.current.acknowledged).toBe(false);
  });

  it("reads existing 'true' from localStorage on mount", () => {
    localStorage.setItem(ACK_KEY, "true");
    const { result } = renderHook(() => useTermsAcknowledgement(ADDR));
    expect(result.current.acknowledged).toBe(true);
  });

  it("acknowledge() flips acknowledged to true and writes localStorage", () => {
    const { result } = renderHook(() => useTermsAcknowledgement(ADDR));
    expect(result.current.acknowledged).toBe(false);

    act(() => {
      result.current.acknowledge();
    });

    expect(result.current.acknowledged).toBe(true);
    expect(localStorage.getItem(ACK_KEY)).toBe("true");
  });

  it("acknowledge() is a no-op when address is undefined", () => {
    const { result } = renderHook(() => useTermsAcknowledgement(undefined));
    act(() => {
      result.current.acknowledge();
    });
    expect(result.current.acknowledged).toBe(false);
    expect(localStorage.getItem(ACK_KEY)).toBeNull();
  });

  it("re-syncs acknowledged when address prop changes", () => {
    const ADDR2 = "0x0000000000000000000000000000000000000002";
    const KEY2 = `pipeline.wallet.termsAcknowledged.${ADDR2.toLowerCase()}`;
    localStorage.setItem(KEY2, "true");

    const { result, rerender } = renderHook(
      ({ addr }: { addr: string }) => useTermsAcknowledgement(addr),
      { initialProps: { addr: ADDR } },
    );

    expect(result.current.acknowledged).toBe(false);

    rerender({ addr: ADDR2 });

    expect(result.current.acknowledged).toBe(true);
  });

  it("cross-tab sync: storage event from another tab flips acknowledged", () => {
    const { result } = renderHook(() => useTermsAcknowledgement(ADDR));
    expect(result.current.acknowledged).toBe(false);

    act(() => {
      // Simulate another tab writing the key by dispatching a StorageEvent.
      const event = new StorageEvent("storage", {
        key: ACK_KEY,
        newValue: "true",
        storageArea: localStorage,
      });
      window.dispatchEvent(event);
    });

    expect(result.current.acknowledged).toBe(true);
  });

  it("cross-tab sync: storage event clearing the key flips acknowledged to false", () => {
    localStorage.setItem(ACK_KEY, "true");
    const { result } = renderHook(() => useTermsAcknowledgement(ADDR));
    expect(result.current.acknowledged).toBe(true);

    act(() => {
      const event = new StorageEvent("storage", {
        key: ACK_KEY,
        newValue: null,
        storageArea: localStorage,
      });
      window.dispatchEvent(event);
    });

    expect(result.current.acknowledged).toBe(false);
  });
});
