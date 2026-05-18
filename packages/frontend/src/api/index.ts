/**
 * Public surface of the API module.
 *
 * Only import from this barrel outside of `src/api/`.
 * Do NOT call `fetch` directly outside this module — the ESLint
 * `no-restricted-globals` rule enforces this boundary.
 *
 * See `src/api/README.md` for the full public API, mock-key schema,
 * and DevTools snippets.
 */
export { apiFetch } from "./client";
export { useRequests } from "./useRequests";
export type {
  RequestItem,
  RequestType,
  RequestStatus,
  RequestsResponse,
  UseRequestsResult,
} from "./useRequests";
