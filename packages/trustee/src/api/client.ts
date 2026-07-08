/**
 * Centralised fetch wrapper for the Pipeline REST API (Trustee app).
 *
 * Modeled on the LP frontend's `apiFetch` (`packages/frontend/src/api/client.ts`),
 * with one addition: it injects `Authorization: Bearer <token>` from the
 * Trustee session store when a token is present (#791). All API calls in the
 * Trustee app must go through `apiFetch` — direct `fetch` calls outside
 * `src/api/` are forbidden by the ESLint `no-restricted-globals` rule (TD-33).
 *
 * Non-2xx responses throw. A `401` throws the typed `ApiUnauthorizedError` so
 * callers (the sign-in flow, and any later protected-endpoint caller) can
 * distinguish "not authorized" from other failures — per the exec plan, a
 * `401` from any protected call should also drop the session back to
 * unauthenticated (left to callers to react to, since only they know whether
 * a 401 means "sign-in rejected" vs. "session expired mid-use").
 */
import { ENV } from "@/lib/env";
import { getSessionToken } from "@/auth/sessionStore";

/** Thrown when the API responds 401 — distinguishes "not authorized" from other errors. */
export class ApiUnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiUnauthorizedError";
  }
}

/**
 * Fetches `${ENV.API_BASE_URL}${path}` and returns the parsed JSON body.
 *
 * Attaches `Authorization: Bearer <token>` when a session token is present;
 * omits the header entirely otherwise (the auth challenge/verify endpoints
 * are unauthenticated by design).
 *
 * Throws `ApiUnauthorizedError` on a `401` response, or a plain `Error` on
 * any other non-2xx response. The error message is the JSON body's `error`
 * field when available, otherwise `response.statusText`.
 *
 * @param path  Path + optional query string, e.g. `"/v1/auth/challenge?address=…"`.
 * @param init  Optional `RequestInit` options (method, headers, body, …).
 */
export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = `${ENV.API_BASE_URL}${path}`;
  const token = getSessionToken();

  const headers = new Headers(init?.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(url, { ...init, headers });

  if (!response.ok) {
    let message = response.statusText;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload?.error) message = payload.error;
    } catch {
      // JSON parse failed — fall back to statusText
    }
    if (response.status === 401) {
      throw new ApiUnauthorizedError(message);
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}
