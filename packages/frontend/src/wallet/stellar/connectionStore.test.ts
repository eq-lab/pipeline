/**
 * Unit tests for the module-level Stellar connection-address store.
 *
 * Tests the set/get/subscribe/notify-on-change-only contract and the
 * hydration guard. Kit event subscriptions are not exercised here — they are
 * covered by the integration behaviour visible in useStellarWallet.test.tsx.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getStellarConnectionAddress,
  setStellarConnectionAddress,
  subscribeStellarConnection,
  isStellarConnectionHydrated,
  markStellarConnectionHydrated,
  _resetStellarConnectionStoreForTests,
} from "./connectionStore";

// ── Mock the kit events to prevent module-load side effects ───────────────────

vi.mock("@creit.tech/stellar-wallets-kit", () => ({
  addressUpdatedEvent: { subscribe: vi.fn() },
  disconnectEvent: { subscribe: vi.fn() },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const ADDR = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const ADDR2 = "GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RIGPZPD5HJVBBR47WM6A";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("connectionStore — basic get/set", () => {
  beforeEach(() => {
    _resetStellarConnectionStoreForTests();
  });

  afterEach(() => {
    _resetStellarConnectionStoreForTests();
  });

  it("starts undefined", () => {
    expect(getStellarConnectionAddress()).toBeUndefined();
  });

  it("returns the address after setStellarConnectionAddress", () => {
    setStellarConnectionAddress(ADDR);
    expect(getStellarConnectionAddress()).toBe(ADDR);
  });

  it("returns undefined after setting to undefined", () => {
    setStellarConnectionAddress(ADDR);
    setStellarConnectionAddress(undefined);
    expect(getStellarConnectionAddress()).toBeUndefined();
  });
});

describe("connectionStore — subscribe / notify", () => {
  beforeEach(() => {
    _resetStellarConnectionStoreForTests();
  });

  afterEach(() => {
    _resetStellarConnectionStoreForTests();
  });

  it("calls listeners when the address changes", () => {
    const listener = vi.fn();
    subscribeStellarConnection(listener);

    setStellarConnectionAddress(ADDR);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does NOT call listeners when the value does not change (same-value write)", () => {
    const listener = vi.fn();
    setStellarConnectionAddress(ADDR);
    subscribeStellarConnection(listener);

    setStellarConnectionAddress(ADDR); // same value — should not notify
    expect(listener).not.toHaveBeenCalled();
  });

  it("calls listeners again when the address changes to a different value", () => {
    const listener = vi.fn();
    setStellarConnectionAddress(ADDR);
    subscribeStellarConnection(listener);

    setStellarConnectionAddress(ADDR2);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("calls listeners when clearing the address (set to undefined)", () => {
    const listener = vi.fn();
    setStellarConnectionAddress(ADDR);
    subscribeStellarConnection(listener);

    setStellarConnectionAddress(undefined);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does NOT call unsubscribed listeners", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeStellarConnection(listener);
    unsubscribe();

    setStellarConnectionAddress(ADDR);
    expect(listener).not.toHaveBeenCalled();
  });

  it("multiple listeners all receive notifications", () => {
    const l1 = vi.fn();
    const l2 = vi.fn();
    subscribeStellarConnection(l1);
    subscribeStellarConnection(l2);

    setStellarConnectionAddress(ADDR);
    expect(l1).toHaveBeenCalledTimes(1);
    expect(l2).toHaveBeenCalledTimes(1);
  });
});

describe("connectionStore — hydration guard", () => {
  beforeEach(() => {
    _resetStellarConnectionStoreForTests();
  });

  afterEach(() => {
    _resetStellarConnectionStoreForTests();
  });

  it("starts unhydrated after reset", () => {
    expect(isStellarConnectionHydrated()).toBe(false);
  });

  it("is hydrated after markStellarConnectionHydrated()", () => {
    markStellarConnectionHydrated();
    expect(isStellarConnectionHydrated()).toBe(true);
  });

  it("reset clears the hydration flag", () => {
    markStellarConnectionHydrated();
    _resetStellarConnectionStoreForTests();
    expect(isStellarConnectionHydrated()).toBe(false);
  });
});
