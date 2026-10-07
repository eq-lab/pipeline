// spec: docs/product-specs/api-authorization-email.md#frontend
const SESSION_KEY = "pipeline.auth.session";
const SETUP_DISMISSED_KEY = "pipeline.auth.accountSetupDismissed";

export interface Session {
  token: string;
  expiresAt: number;
  email?: string;
}

interface StoredSession {
  token: string;
  expiresAt: number;
  email?: string;
}

const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

export function saveSession({
  token,
  expires_in,
  email,
}: {
  token: string;
  expires_in: number;
  email?: string;
}): void {
  const stored: StoredSession = {
    token,
    expiresAt: Date.now() + expires_in * 1000,
    ...(email ? { email: email.trim().toLowerCase() } : {}),
  };
  if (localStorage.getItem(SETUP_DISMISSED_KEY) !== token) {
    localStorage.removeItem(SETUP_DISMISSED_KEY);
  }
  localStorage.setItem(SESSION_KEY, JSON.stringify(stored));
  notify();
}

export function readSession(): Session | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;

  let parsed: Partial<StoredSession>;
  try {
    parsed = JSON.parse(raw) as Partial<StoredSession>;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
  if (
    typeof parsed.token !== "string" ||
    typeof parsed.expiresAt !== "number"
  ) {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
  if (parsed.expiresAt <= Date.now()) {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
  return {
    token: parsed.token,
    expiresAt: parsed.expiresAt,
    ...(typeof parsed.email === "string" && parsed.email.trim()
      ? { email: parsed.email.trim().toLowerCase() }
      : {}),
  };
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SETUP_DISMISSED_KEY);
  notify();
}

export function markAccountSetupDismissed(token: string): void {
  localStorage.setItem(SETUP_DISMISSED_KEY, token);
}

export function isAccountSetupDismissed(token: string): boolean {
  return localStorage.getItem(SETUP_DISMISSED_KEY) === token;
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function authHeaders(): Record<string, string> {
  const session = readSession();
  return session ? { Authorization: `Bearer ${session.token}` } : {};
}
