/**
 * React Query hook — fetches the active loan book from the Pipeline API
 * (`GET /v1/loan-book`).
 *
 * The hook is always enabled (no wallet connection required — this is a
 * protocol-level view visible to everyone).
 *
 * Mock layer
 * ----------
 * Before issuing a real network request, `apiFetch` checks:
 *
 *   `pipeline.mock.api.GET./v1/loan-book`
 *
 * When the key is present its value is parsed as JSON and returned immediately.
 *
 * See `src/api/README.md` for the full mock-key schema and DevTools snippets.
 *
 * Data-layer note
 * ---------------
 * `total_deployed`, `total_collateral`, `principal`, and `collateral` are
 * **base-6 decimal strings already in human units** (e.g. `"8000000.000000"`
 * = $8M USDC) — they are NOT raw sub-unit bigints, so never call `formatUsdc`
 * / `parseUnits` on them. The frontend no longer rescales these values — the
 * former ×1000 `scaleRegistryAmount`/`formatRegistryCompactUsd` workaround
 * (issue #840) has been removed (issue #906); they are displayed exactly as
 * served, via plain `formatCompactUsd` from `@/utils/formatCompactUsd`.
 */
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { ENV } from "@/lib/env";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Portfolio-level aggregates for the Loan Book header cards. */
export interface LoanBookSummary {
  /** Total capital deployed, USDC — base-6 decimal string (human units). */
  total_deployed: string;
  /**
   * Total collateral value, USDC — base-6 decimal string (human units).
   * `null` until a commodity price feed is wired (TODO #706). Displayed
   * exactly as served by the backend (issue #906 — no frontend rescaling).
   */
  total_collateral: string | null;
  /**
   * Senior debt coverage ratio — 2-decimal string (e.g. `"1.50"`).
   * `null` while `total_collateral` is unavailable (TODO #706).
   */
  senior_debt_coverage: string | null;
  /**
   * Principal-weighted yield — decimal-fraction string (e.g. `"0.112000"` = 11.2%).
   * `null` when no active loans exist.
   */
  avg_yield: string | null;
  /**
   * Principal-weighted average loan term in days.
   * `null` when no active loans exist.
   */
  avg_duration_days: number | null;
}

/** One row in the active-loan table. */
export interface LoanBookEntry {
  /** Originating party (e.g. `"Open Mineral"`). */
  originator: string;
  /** Borrower identifier. */
  borrower: string;
  /** Underlying commodity (e.g. `"Copper Concentrate"`). */
  commodity: string;
  /** Principal = senior + equity tranche, USDC — base-6 decimal string (human units). */
  principal: string;
  /**
   * Collateral value, USDC — base-6 decimal string (human units).
   * `null` until a price feed is available (TODO #706). Displayed exactly as
   * served by the backend (issue #906 — no frontend rescaling).
   */
  collateral: string | null;
  /**
   * Loan-to-value — 4-decimal fraction string (e.g. `"0.8511"`) =
   * `principal / collateral`. `null` while `collateral` is unavailable
   * (TODO #706). Served ALREADY CORRECT — do NOT scale.
   */
  ltv: string | null;
  /** Original loan term in days (`maturity − origination`). */
  duration_days: number;
  /** Senior interest rate — decimal-fraction string (e.g. `"0.112000"` = 11.2%). */
  rate: string;
  /**
   * Trade-finance protection instrument (e.g. `"LC at sight"`, `"Doc. coll."`).
   * `null` when the loan has no protection recorded.
   */
  protection: string | null;
  /** Loan status from the latest snapshot (e.g. `"Performing"`). */
  status: string;
}

/** Shape of the `GET /v1/loan-book` response. */
export interface LoanBookResponse {
  summary: LoanBookSummary;
  /** Active loans, sorted by principal descending. */
  loans: LoanBookEntry[];
}

/** Return value of `useLoanBook`. */
export interface UseLoanBookResult {
  data: LoanBookResponse | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Returns the protocol loan book: portfolio summary + active-loan table.
 *
 * - Always enabled — no wallet connection required.
 * - Polls every 30 s per the dashboard "Real-time updates" convention
 *   (`docs/FRONTEND.md`).
 *
 * All monetary string fields are base-6 decimal strings **already in human
 * units**. Use `formatCompactUsd` (not `formatUsdc`) to display them.
 */
export function useLoanBook(): UseLoanBookResult {
  // Protocol Dashboard is Stellar-scoped — query the Stellar chain (99000001).
  const chainId = ENV.STELLAR_CHAIN_ID;
  const query = useQuery<LoanBookResponse, Error>({
    queryKey: ["loan-book", chainId],
    queryFn: () =>
      apiFetch<LoanBookResponse>(`/v1/loan-book?chain_id=${chainId}`),
    refetchInterval: 30_000,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}
