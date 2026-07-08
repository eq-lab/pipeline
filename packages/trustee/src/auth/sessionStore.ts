/**
 * Trustee session store — module-level state for the backend-issued JWT.
 *
 * Per the #791 exec plan Decision Log: the backend
 * (`packages/api/src/routes/auth.rs`) issues a client-held bearer token —
 * there is no `Set-Cookie`, no cookie/session middleware, and no
 * `me`/`refresh`/`logout` endpoint. The client stores the token itself and
 * attaches it as `Authorization: Bearer <token>`. Sign-out is purely
 * client-side (drop the stored token); there is no server logout to call.
 *
 * This module is the single source of truth for the session, persisted in
 * `sessionStorage` (not `localStorage` — the JWT should not outlive the
 * browser tab, see the exec plan's storage-choice rationale) under one key.
 * It exposes:
 *   - A reactive `useSessionState()` hook (via `useSyncExternalStore`) for
 *     `TrusteeSessionProvider` and any component that needs to re-render on
 *     session changes.
 *   - Non-hook accessors (`getSessionToken()`, `getSessionState()`) so
 *     `apiFetch` (a plain function, not a hook) and the router's `beforeLoad`
 *     guard (which runs outside React) can read the session synchronously.
 *
 * Mirrors the module-level external-store pattern already used by
 * `@pipeline/wallet-connect`'s Stellar `connectionStore.ts`.
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

/** Hydrate in-memory state from `sessionStorage` exactly once, at module load. */
function hydrate(): void {
  const stored = readStorage();
  if (stored && !isExpired(stored)) {
    session = stored;
    status = "authenticated";
  } else if (stored) {
    // Expired — drop it.
    writeStorage(undefined);
  }
}

hydrate();

// ── Public API ────────────────────────────────────────────────────────────────

/** Non-reactive: the current bearer token, or `undefined` if unauthenticated/expired. */
export function getSessionToken(): string | undefined {
  if (session && isExpired(session)) {
    setSession(undefined, "unauthenticated");
    return undefined;
  }
  return session?.token;
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

/**
 * Set the session status (and optional error). Does not touch the stored
 * token — use `setSession` for that.
 */
export function setSessionStatus(
  next: SessionStatus,
  nextError?: string,
): void {
  status = next;
  error = nextError;
  notify();
}

/**
 * Set (or clear) the authenticated session. Persists to `sessionStorage` and
 * updates `status` to `authenticated` when a session is provided, or
 * `unauthenticated` when cleared.
 */
export function setSession(
  next: StoredSession | undefined,
  nextStatus?: SessionStatus,
): void {
  session = next;
  writeStorage(next);
  status = nextStatus ?? (next ? "authenticated" : "unauthenticated");
  error = undefined;
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
  session = undefined;
  status = "unauthenticated";
  error = undefined;
  cachedSnapshot = { status, address: undefined, error };
  listeners.clear();
  writeStorage(undefined);
}
