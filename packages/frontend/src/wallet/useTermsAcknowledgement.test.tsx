import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useTermsAcknowledgement,
  readTermsAcknowledged,
} from "./useTermsAcknowledgement";

const TERMS_KEY = "pipeline.wallet.termsAcknowledged";
const PENDING_KEY = "pipeline.wallet.termsAcknowledged.pending";
const ADDR = "0xabcdef0000000000000000000000000000000001";

describe("readTermsAcknowledged — synchronous helper", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("returns false when localStorage key is absent", () => {
    expect(readTermsAcknowledged()).toBe(false);
  });

  it("returns true when the flat key is 'true'", () => {
    localStorage.setItem(TERMS_KEY, "true");
    expect(readTermsAcknowledged()).toBe(true);
  });

  it("returns false when the flat key is some other value", () => {
    localStorage.setItem(TERMS_KEY, "yes");
    expect(readTermsAcknowledged()).toBe(false);
  });

  it("Migration: returns true and back-fills flat key when legacy pending key is 'true'", () => {
    localStorage.setItem(PENDING_KEY, "true");
    expect(readTermsAcknowledged()).toBe(true);
    // Back-fill should have happened.
    expect(localStorage.getItem(TERMS_KEY)).toBe("true");
  });

  it("Migration: returns true and back-fills flat key when legacy address-scoped key is 'true'", () => {
    const legacyKey = `pipeline.wallet.termsAcknowledged.${ADDR}`;
    localStorage.setItem(legacyKey, "true");
    expect(readTermsAcknowledged()).toBe(true);
    expect(localStorage.getItem(TERMS_KEY)).toBe("true");
  });

  it("Migration: returns false when legacy key is present but value is not 'true'", () => {
    localStorage.setItem(PENDING_KEY, "false");
    expect(readTermsAcknowledged()).toBe(false);
  });
});

describe("useTermsAcknowledgement — hook", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("returns acknowledged: false by default", () => {
    const { result } = renderHook(() => useTermsAcknowledgement());
    expect(result.current.acknowledged).toBe(false);
  });

  it("reads existing 'true' from localStorage on mount", () => {
    localStorage.setItem(TERMS_KEY, "true");
    const { result } = renderHook(() => useTermsAcknowledgement());
    expect(result.current.acknowledged).toBe(true);
  });

  it("acknowledge() flips acknowledged to true and writes localStorage", () => {
    const { result } = renderHook(() => useTermsAcknowledgement());
    expect(result.current.acknowledged).toBe(false);

    act(() => {
      result.current.acknowledge();
    });

    expect(result.current.acknowledged).toBe(true);
    expect(localStorage.getItem(TERMS_KEY)).toBe("true");
  });

  it("cross-tab sync: storage event on the flat key flips acknowledged to true", () => {
    const { result } = renderHook(() => useTermsAcknowledgement());
    expect(result.current.acknowledged).toBe(false);

    act(() => {
      const event = new StorageEvent("storage", {
        key: TERMS_KEY,
        newValue: "true",
        storageArea: localStorage,
      });
      window.dispatchEvent(event);
    });

    expect(result.current.acknowledged).toBe(true);
  });

  it("cross-tab sync: storage event clearing the key flips acknowledged to false", () => {
    localStorage.setItem(TERMS_KEY, "true");
    const { result } = renderHook(() => useTermsAcknowledgement());
    expect(result.current.acknowledged).toBe(true);

    act(() => {
      const event = new StorageEvent("storage", {
        key: TERMS_KEY,
        newValue: null,
        storageArea: localStorage,
      });
      window.dispatchEvent(event);
    });

    expect(result.current.acknowledged).toBe(false);
  });

  it("cross-tab sync: storage event on an unrelated key does NOT flip acknowledged", () => {
    const { result } = renderHook(() => useTermsAcknowledgement());
    expect(result.current.acknowledged).toBe(false);

    act(() => {
      const event = new StorageEvent("storage", {
        key: "pipeline.wallet.termsAcknowledged.pending",
        newValue: "true",
        storageArea: localStorage,
      });
      window.dispatchEvent(event);
    });

    // No change — we only listen to the flat TERMS_KEY.
    expect(result.current.acknowledged).toBe(false);
  });
});
