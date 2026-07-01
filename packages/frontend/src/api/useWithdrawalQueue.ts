/**
 * React Query hook — fetches the withdrawal queue from the Pipeline API
 * (`GET /v1/withdrawal-queue`).
 *
 * The hook is always enabled (no wallet connection required — this is a
 * protocol-level view visible to everyone).
 *
 * Mock layer
 * ----------
 * Before issuing a real network request, `apiFetch` checks:
 *
 *   `pipeline.mock.api.GET./v1/withdrawal-queue`
 *
 * When the key is present its value is parsed as JSON and returned immediately.
 *
 * See `src/api/README.md` for the full mock-key schema and DevTools snippets.
 *
 * Data-layer note
 * ---------------
 * `in_queue_usd` and `amount` are **base-6 decimal strings already in human
 * units** (e.g. `"620000.000000"` = $0.62M USDC). They are NOT raw sub-unit
 * bigints. Use `formatCompactUsd` from `@/utils/formatCompactUsd` — do NOT
 * call `formatUsdc` / `parseUnits` on them.
 *
 * `estimated_wait_days` is a 1-decimal string (e.g. `"3.2"`) or `null`.
 * `liquid_cover` is currently always `null` (pending the Panel A reserves
 * endpoint — render `"—"` until then; do NOT compute client-side).
 * `status` is one of `"Queued"` | `"Completed"`. Items are newest-first.
 */
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Portfolio-level aggregates for the Withdrawal Queue header cards. */
export interface WithdrawalQueueSummary {
  /** Total amount in queue, USDC — base-6 decimal string (human units). */
  in_queue_usd: string;
  /** Number of withdrawal requests. */
  requests_count: number;
  /**
   * Estimated wait time in days — 1-decimal string (e.g. `"3.2"`).
   * `null` when the estimate is unavailable.
   */
  estimated_wait_days: string | null;
  /**
   * Liquid cover ratio — 2-decimal string (e.g. `"5.60"`).
   * Currently always `null` — pending the Panel A reserves endpoint (#?).
   * Render `"—"` until the backend delivers this field.
   */
  liquid_cover: string | null;
}

/** One row in the withdrawal queue table. */
export interface WithdrawalQueueItem {
  /** Withdrawer wallet address (EVM or Stellar). */
  account: string;
  /** Withdrawal amount, USDC — base-6 decimal string (human units). */
  amount: string;
  /**
   * Request status. The two known values are `"Queued"` and `"Completed"`.
   * The string-literal union is intentionally kept narrow; an unexpected
   * server value will still render verbatim as a fallback (the type is
   * widened to `string` for safety below the union).
   */
  status: "Queued" | "Completed" | (string & Record<never, never>);
}

/** Shape of the `GET /v1/withdrawal-queue` response. */
export interface WithdrawalQueueResponse {
  summary: WithdrawalQueueSummary;
  /** Withdrawal requests, newest-first. */
  items: WithdrawalQueueItem[];
}

/** Return value of `useWithdrawalQueue`. */
export interface UseWithdrawalQueueResult {
  data: WithdrawalQueueResponse | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Returns the protocol withdrawal queue: summary cards + queue items table.
 *
 * - Always enabled — no wallet connection required.
 * - Polls every 30 s per the dashboard "Real-time updates" convention
 *   (`docs/FRONTEND.md`).
 *
 * All monetary string fields are base-6 decimal strings **already in human
 * units**. Use `formatCompactUsd` (not `formatUsdc`) to display them.
 */
export function useWithdrawalQueue(): UseWithdrawalQueueResult {
  const query = useQuery<WithdrawalQueueResponse, Error>({
    queryKey: ["withdrawal-queue"],
    queryFn: () => apiFetch<WithdrawalQueueResponse>("/v1/withdrawal-queue"),
    refetchInterval: 30_000,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}
