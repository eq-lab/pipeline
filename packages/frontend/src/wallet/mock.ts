/**
 * localStorage mock layer for the wallet module.
 *
 * Every value the wallet context exposes can be overridden by a
 * `pipeline.mock.wallet.*` key in `localStorage`.  When the key is present
 * the wallet module returns the parsed value and skips any real RPC call.
 *
 * See `packages/frontend/src/wallet/README.md` for the full key schema and
 * worked DevTools console snippets.
 */
import { useSyncExternalStore } from "react";

/** Custom event name dispatched when a mock key is written in the same tab. */
const MOCK_EVENT = "pipeline-mock:wallet";

/** Whether `installSameTabMockBridge()` has already patched `localStorage`. */
let bridgeInstalled = false;

/** Saved reference to the original localStorage methods for test cleanup. */
let _savedSetItem: typeof localStorage.setItem | null = null;
let _savedRemoveItem: typeof localStorage.removeItem | null = null;

/**
 * Fully reset the bridge state (flag + restore original localStorage methods).
 * FOR TESTS ONLY — call this in `beforeEach`/`afterEach` when testing the
 * bridge directly to guarantee isolation across test files.
 */
export function _resetBridgeForTests(): void {
  if (_savedSetItem) localStorage.setItem = _savedSetItem;
  if (_savedRemoveItem) localStorage.removeItem = _savedRemoveItem;
  bridgeInstalled = false;
  _savedSetItem = null;
  _savedRemoveItem = null;
}

/**
 * Patches `localStorage.setItem` and `localStorage.removeItem` ONCE per page
 * lifetime so that writes from the DevTools console (or from code) fan out to
 * the same-tab mock subscribers.
 *
 * Idempotent — calling it twice has no additional effect.
 * Called from `WalletProvider` on mount.
 */
export function installSameTabMockBridge(): () => void {
  if (bridgeInstalled) return () => {};

  const originalSetItem = localStorage.setItem.bind(localStorage);
  const originalRemoveItem = localStorage.removeItem.bind(localStorage);

  // Save for _resetBridgeForTests so test cleanup can restore without calling
  // the returned cleanup function.
  _savedSetItem = originalSetItem;
  _savedRemoveItem = originalRemoveItem;

  localStorage.setItem = (key: string, value: string) => {
    originalSetItem(key, value);
    if (key.startsWith("pipeline.mock.")) {
      window.dispatchEvent(new CustomEvent(MOCK_EVENT, { detail: { key } }));
    }
  };

  localStorage.removeItem = (key: string) => {
    originalRemoveItem(key);
    if (key.startsWith("pipeline.mock.")) {
      window.dispatchEvent(new CustomEvent(MOCK_EVENT, { detail: { key } }));
    }
  };

  bridgeInstalled = true;

  return () => {
    // Restore original methods on cleanup (useful in tests).
    localStorage.setItem = originalSetItem;
    localStorage.removeItem = originalRemoveItem;
    bridgeInstalled = false;
    _savedSetItem = null;
    _savedRemoveItem = null;
  };
}

/**
 * Read a mock value from `localStorage`, parsing it with `parse`.
 * Returns `undefined` if the key is absent or the parse function throws.
 */
export function readMock<T>(
  key: string,
  parse: (raw: string) => T,
): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return undefined;
    return parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * Subscribe to changes for a specific mock key.
 * Listens to:
 *   - `storage` events (cross-tab writes)
 *   - `pipeline-mock:wallet` custom events (same-tab writes via patched setItem)
 *
 * Returns an unsubscribe function.
 */
export function subscribeMock(_key: string, listener: () => void): () => void {
  // We subscribe to all mock events (not just the specific key) for simplicity.
  // The listener will cause a re-read; if the value hasn't changed for this
  // specific key React will bail out after the equality check.
  const onStorage = () => listener();
  const onCustom = () => listener();

  window.addEventListener("storage", onStorage);
  window.addEventListener(MOCK_EVENT, onCustom);

  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(MOCK_EVENT, onCustom);
  };
}

/**
 * React hook that reads a mock value reactively.
 * Re-renders when the mock key changes (cross-tab or same-tab via the bridge).
 */
export function useMock<T>(
  key: string,
  parse: (raw: string) => T,
): T | undefined {
  return useSyncExternalStore(
    (listener) => subscribeMock(key, listener),
    () => readMock(key, parse),
    () => undefined, // SSR snapshot — always undefined
  );
}

// ── Parse helpers ──────────────────────────────────────────────────────────────

export function parseAddress(raw: string): `0x${string}` {
  if (!raw.startsWith("0x")) throw new Error(`Not an address: ${raw}`);
  return raw as `0x${string}`;
}

export function parseBoolean(raw: string): boolean {
  return raw === "true";
}

export function parseNumber(raw: string): number {
  const n = Number(raw);
  if (Number.isNaN(n)) throw new Error(`Not a number: ${raw}`);
  return n;
}

export function parseBigInt(raw: string): bigint {
  return BigInt(raw);
}

export function parseJson<T = unknown>(raw: string): T {
  return JSON.parse(raw) as T;
}
