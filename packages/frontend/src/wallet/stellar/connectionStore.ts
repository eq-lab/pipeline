/**
 * Shared Stellar connection-address store.
 *
 * Mirrors the module-level singleton pattern used by the Stellar kit itself
 * (`StellarWalletsKit` in `./config` is a module-level singleton). Every
 * `useStellarWallet()` instance reads from this single store so that
 * connect/disconnect in ANY component immediately propagates to ALL consumers
 * without a page reload.
 *
 * This intentionally mirrors the `useSyncExternalStore` pattern already used
 * by the mock layer (`useMock` in `../evm/mock.ts`).  The mock path is
 * unchanged — `useMockStellarAddress` continues to override the real address,
 * preserving mock precedence.
 *
 * The kit exposes `addressUpdatedEvent` and `disconnectEvent` subjects.  We
 * subscribe once at module load so that extension-initiated address changes and
 * disconnects propagate automatically — not only in-app connect/disconnect.
 */

import { useSyncExternalStore } from "react";
import {
  addressUpdatedEvent,
  disconnectEvent,
} from "@creit.tech/stellar-wallets-kit";
import type { IKitError } from "@creit.tech/stellar-wallets-kit";

// ── Internal state ─────────────────────────────────────────────────────────────

let currentAddress: string | undefined = undefined;
const listeners = new Set<() => void>();

/**
 * Guard so `getAddress()` hydration runs only once per page lifetime.
 * Reset by `_resetStellarConnectionStoreForTests()` so tests stay isolated.
 */
let hydrated = false;

// ── Public API ─────────────────────────────────────────────────────────────────

/** Non-reactive snapshot getter — used by `useSyncExternalStore`. */
export function getStellarConnectionAddress(): string | undefined {
  return currentAddress;
}

/**
 * Update the shared address.  Notifies subscribers only when the value
 * actually changes (same-value writes are silently dropped).
 */
export function setStellarConnectionAddress(
  addr: string | undefined,
): void {
  if (addr === currentAddress) return;
  currentAddress = addr;
  listeners.forEach((l) => l());
}

/**
 * Subscribe to address changes.  Returns an unsubscribe function.
 *
 * Conforms to the `subscribe` signature expected by `useSyncExternalStore`.
 */
export function subscribeStellarConnection(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * React hook that returns the current real Stellar address reactively.
 *
 * Returns `undefined` when no wallet is connected.  SSR snapshot is always
 * `undefined` (matching the mock-layer convention).
 */
export function useStellarConnectionAddress(): string | undefined {
  return useSyncExternalStore(
    subscribeStellarConnection,
    getStellarConnectionAddress,
    () => undefined, // SSR snapshot
  );
}

/**
 * Mark hydration as done so the mount-time `getAddress()` effect runs only
 * once across all hook instances.
 */
export function markStellarConnectionHydrated(): void {
  hydrated = true;
}

/** Returns `true` once the store has been hydrated from `getAddress()`. */
export function isStellarConnectionHydrated(): boolean {
  return hydrated;
}

/**
 * Reset all store state (address, listeners, hydration guard).
 *
 * FOR TESTS ONLY — call this in `beforeEach`/`afterEach` to guarantee
 * isolation across tests that use the module-level store.
 * Mirrors `_resetBridgeForTests` in `../evm/mock.ts`.
 */
export function _resetStellarConnectionStoreForTests(): void {
  currentAddress = undefined;
  listeners.clear();
  hydrated = false;
}

// ── Kit event subscriptions ────────────────────────────────────────────────────
//
// The kit's `addressUpdatedEvent` fires when the connected address changes
// (e.g. wallet extension switches accounts).  `disconnectEvent` fires on
// extension-initiated disconnects.  We subscribe once at module load so that
// these external events propagate to all `useStellarWallet()` consumers
// automatically — in addition to the in-app connect/disconnect paths driven
// by our own setStellarConnectionAddress calls.

function isKitError(value: string | IKitError): value is IKitError {
  return typeof value === "object" && value !== null && "code" in value;
}

addressUpdatedEvent.subscribe((value) => {
  if (isKitError(value)) {
    // Kit reported an error (e.g. wallet extension unavailable).
    // Clear the address so consumers reflect the disconnected state.
    setStellarConnectionAddress(undefined);
  } else {
    setStellarConnectionAddress(value || undefined);
  }
});

disconnectEvent.subscribe(() => {
  setStellarConnectionAddress(undefined);
});
