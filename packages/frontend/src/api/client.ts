/**
 * Centralised fetch wrapper for the Pipeline REST API.
 *
 * All API calls in the application must go through `apiFetch` — direct `fetch`
 * calls outside `src/api/` are forbidden by the ESLint `no-restricted-globals`
 * rule.
 *
 * Mock layer
 * ----------
 * Before issuing a real network request, `apiFetch` checks two localStorage
 * keys (lookup order: most-specific first):
 *
 *   1. `pipeline.mock.api.<METHOD>.<path-with-query-string>`
 *      e.g. `pipeline.mock.api.GET./v1/requests?wallet=0x1234`
 *   2. `pipeline.mock.api.<METHOD>.<path-without-query-string>`
 *      e.g. `pipeline.mock.api.GET./v1/requests`
 *
 * When a key is present its value is parsed as JSON and returned immediately —
 * no network call is made. When neither key is present the real `fetch` is used.
 *
 * Reactivity: mock-key changes are picked up on the next `useRequests` refetch.
 * The `subscribeMock` bridge (installed by `WalletProvider`) fires the
 * `pipeline-mock:wallet` custom event on every `pipeline.mock.*` write, which
 * causes React Query to refetch via a `useSyncExternalStore` subscriber in
 * `useRequests.ts`.
 *
 * Note: the `pipeline-mock:wallet` event name is a legacy misnomer — the bridge
 * covers all `pipeline.mock.*` keys, not just wallet ones. Renaming it is out
 * of scope; the API module reuses it as documented in `src/api/README.md`.
 *
 * See `src/api/README.md` for the full mock-key schema and DevTools snippets.
 */
import { ENV } from "@/lib/env";
import { readMock, parseJson } from "@/wallet";

/**
 * Fetches `${ENV.API_BASE_URL}${path}` and returns the parsed JSON body.
 *
 * Mock lookup order (both checked before issuing a real fetch):
 *   1. `pipeline.mock.api.<METHOD>.<path>` (path includes query string)
 *   2. `pipeline.mock.api.<METHOD>.<path-without-query>` (alias without `?…`)
 *
 * Throws an `Error` on non-2xx responses. The error message is the `error`
 * field from the JSON body when available, otherwise `response.statusText`.
 *
 * @param path  Path + optional query string, e.g. `"/v1/requests?wallet=0x…"`.
 * @param init  Optional `RequestInit` options (method, headers, body, …).
 */
export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();

  // ── Mock lookup ──────────────────────────────────────────────────────────

  // Key 1: exact path (with query string if present)
  const mockKey1 = `pipeline.mock.api.${method}.${path}`;
  const mock1 = readMock<T>(mockKey1, parseJson);
  if (mock1 !== undefined) return mock1;

  // Key 2: path without query string
  const pathWithoutQuery = path.split("?")[0]!;
  if (pathWithoutQuery !== path) {
    const mockKey2 = `pipeline.mock.api.${method}.${pathWithoutQuery}`;
    const mock2 = readMock<T>(mockKey2, parseJson);
    if (mock2 !== undefined) return mock2;
  }

  // ── Real fetch ───────────────────────────────────────────────────────────

  const url = `${ENV.API_BASE_URL}${path}`;
  const response = await fetch(url, init);

  if (!response.ok) {
    let message = response.statusText;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload?.error) message = payload.error;
    } catch {
      // JSON parse failed — fall back to statusText
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}
