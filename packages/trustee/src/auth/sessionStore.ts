/**
 * Trustee session store — module-level external store for the backend-issued
 * JWT, persisted in sessionStorage (must not outlive the tab). Exposes the
 * reactive `useSessionState()` plus non-hook accessors for code that runs
 * outside React (`apiFetch`, the router guard).
 *
 * spec: docs/frontend/trustee-flows.md#session-store-sessionstorets.
 */
import { useSyncExternalStore } from "react";

const STORAGE_KEY = "pipeline.trustee.session";

export interface StoredSession {
  token: string;
  address: string;
  chainId: number;
  /** Epoch milliseconds when the token expires. */
  expiresAt: number;
}

export type SessionStatus =
  | "unauthenticated"
  | "connecting"
  | "authenticated"
  | "unauthorized";

export interface SessionState {
  status: SessionStatus;
  address: string | undefined;
  /** Human-readable error surfaced on the sign-in card (e.g. "not authorized"). */
  error: string | undefined;
}

// ── Internal state ────────────────────────────────────────────────────────────

let session: StoredSession | undefined;
let status: SessionStatus = "unauthenticated";
let error: string | undefined;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((l) => l());
}

function readStorage(): StoredSession | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as StoredSession;
    if (
      typeof parsed.token !== "string" ||
      typeof parsed.address !== "string" ||
      typeof parsed.chainId !== "number" ||
      typeof parsed.expiresAt !== "number"
    ) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function writeStorage(next: StoredSession | undefined): void {
  if (typeof window === "undefined") return;
  try {
    if (next) {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } else {
      window.sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // sessionStorage unavailable (e.g. private browsing) — in-memory state
    // still works for the current page lifetime.
  }
}

function isExpired(s: StoredSession): boolean {
  return Date.now() >= s.expiresAt;
}

// ── Reactive expiry ───────────────────────────────────────────────────────────
// Evicts the session the instant the token expires so an idle trustee is
// re-gated without a failed API call (spec).

let expiryTimer: ReturnType<typeof setTimeout> | undefined;

function clearExpiryTimer(): void {
  if (expiryTimer !== undefined) {
    clearTimeout(expiryTimer);
    expiryTimer = undefined;
  }
}

/** Timer callback — evict iff the token has actually expired; re-arm on early fire. */
function evictIfExpired(): void {
  expiryTimer = undefined;
  if (!session) return;
  if (isExpired(session)) {
    setSession(undefined, "unauthenticated");
  } else {
    // Fired early (clock skew / timer coalescing) — re-arm for the remainder.
    armExpiryTimer();
  }
}

/** (Re)arm the eviction timer for the current session; clears it when none. */
function armExpiryTimer(): void {
  clearExpiryTimer();
  if (typeof window === "undefined" || !session) return;
  // `setTimeout` clamps huge delays, but 24h (< the ~24.8-day max) is safe. A
  // non-positive delay (already expired) evicts on the next tick.
  const delay = Math.max(0, session.expiresAt - Date.now());
  expiryTimer = setTimeout(evictIfExpired, delay);
}

/** Hydrate in-memory state from `sessionStorage` exactly once, at module load. */
function hydrate(): void {
  const stored = readStorage();
  if (stored && !isExpired(stored)) {
    session = stored;
    status = "authenticated";
    armExpiryTimer();
  } else if (stored) {
    // Expired — drop it.
    writeStorage(undefined);
  }
}

hydrate();

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Non-reactive AND pure — no writes/notifications, so `apiFetch` reading the
 * token never triggers a re-render (#795). Expiry eviction is the timer's job.
 */
export function getSessionToken(): string | undefined {
  if (session && !isExpired(session)) return session.token;
  return undefined;
}

// `useSyncExternalStore` requires `getSnapshot()` to return a referentially
// stable value when nothing has changed — otherwise it re-renders forever.
// Cache the last snapshot and only allocate a new object when a field
// actually changed.
let cachedSnapshot: SessionState = { status, address: undefined, error };

function computeSnapshot(): SessionState {
  const address = session?.address;
  if (
    cachedSnapshot.status === status &&
    cachedSnapshot.address === address &&
    cachedSnapshot.error === error
  ) {
    return cachedSnapshot;
  }
  cachedSnapshot = { status, address, error };
  return cachedSnapshot;
}

/** Non-reactive: the full session state snapshot (referentially stable — see `computeSnapshot`). */
export function getSessionState(): SessionState {
  return computeSnapshot();
}

/** Set status (+ optional error) without touching the stored token. */
export function setSessionStatus(
  next: SessionStatus,
  nextError?: string,
): void {
  status = next;
  error = nextError;
  notify();
}

/** Set (or clear) the session; persists and derives `status`. */
export function setSession(
  next: StoredSession | undefined,
  nextStatus?: SessionStatus,
): void {
  session = next;
  writeStorage(next);
  status = nextStatus ?? (next ? "authenticated" : "unauthenticated");
  error = undefined;
  armExpiryTimer();
  notify();
}

/** Subscribe to session changes. Returns an unsubscribe function. */
export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Stable SSR snapshot — referentially stable across calls (see `computeSnapshot`). */
const SSR_SNAPSHOT: SessionState = {
  status: "unauthenticated",
  address: undefined,
  error: undefined,
};

/** Reactive hook — re-renders when the session state changes. */
export function useSessionState(): SessionState {
  return useSyncExternalStore(
    subscribeSession,
    getSessionState,
    () => SSR_SNAPSHOT,
  );
}

/** Test helper — resets all module state. FOR TESTS ONLY. */
export function _resetSessionStoreForTests(): void {
  clearExpiryTimer();
  session = undefined;
  status = "unauthenticated";
  error = undefined;
  cachedSnapshot = { status, address: undefined, error };
  listeners.clear();
  writeStorage(undefined);
}
