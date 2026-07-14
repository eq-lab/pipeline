/**
 * React Query hook — fetches the active loan book from the Pipeline API
 * (`GET /v1/loan-book`) for the Trustee **Loans** page (issue #843, Figma
 * node `4116:9989`).
 *
 * Mirrors `useLoanSubmissions.ts`'s conventions (queryKey shape, `apiFetch`,
 * `refetchInterval`, Stellar-scoped `chain_id`). The trustee app deliberately
 * does NOT depend on `@pipeline/frontend` (epic #775 keeps the two apps
 * separate), so the types below are a self-contained port of the post-#833
 * backend shape (`packages/api/src/routes/loan_book.rs`) rather than an
 * import — a fourth hand-mirroring alongside TD-42's existing trustee/LP
 * pairs (see `docs/exec-plans/tech-debt-tracker.md`). The pre-#833 LP
 * frontend hook (`packages/frontend/src/api/useLoanBook.ts`) predates the
 * Trustee-only summary fields below and is NOT extended here — only this
 * trustee copy carries them.
 *
 * Data-layer note
 * ---------------
 * `deployed_senior`, `at_risk_wl_and_default_senior`, and per-loan
 * `senior_outstanding`/`principal` are **registry-sourced** base-6 decimal
 * strings (already in human units, e.g. `"1200000.000000"` = $1.2M) that are
 * **1000× too small** on the wire (issue #840) — scale them with
 * `scaleRegistryAmount`/`formatRegistryCompactUsd`/`formatRegistryCompact2dpUsd`
 * from `@/utils/formatUsd` before display. `collateral` (and
 * `total_collateral`, not used on this page) is price-feed sourced (#706)
 * and already correct-scale — do NOT scale it. `ccr_bps` and
 * `at_risk_wl_and_default_pct` are backend-computed ratios that mix a
 * registry-scaled value with a correct-scale one, so the ×1000 amount
 * helper cannot repair them directly — see `-useLoansTable.ts` for the
 * CCR-specific ÷1000 display correction (the resolved Open Question 1 for
 * issue #843).
 */
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { ENV } from "@/lib/env";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Largest single-commodity exposure in the active loan book (Top concentration tile). */
export interface TopConcentration {
  /** Underlying commodity with the largest senior exposure. */
  commodity: string;
  /**
   * That commodity's share of Σ outstanding senior, 4-decimal fraction
   * (e.g. `"0.0720"` = 7.2%). Ratio of two registry amounts — the ×1000
   * scale cancels, so this is already correct; do NOT scale it.
   */
  share: string;
}

/** Portfolio-level aggregates for the Loans page's summary cards. */
export interface LoanBookSummary {
  /**
   * Σ (senior + equity tranche) over active loans, USDC base-6 decimal
   * string. Not rendered on this page (kept for shape parity with the
   * backend DTO).
   */
  total_deployed: string;
  /** Price-feed sourced (#706); `null` until a commodity price is wired. Not scaled. */
  total_collateral: string | null;
  /** `total_collateral / Σ senior_tranche`, 2-decimal string. Not rendered on this page. */
  senior_debt_coverage: string | null;
  /** Principal-weighted senior interest rate, decimal-fraction string. Not rendered on this page. */
  avg_yield: string | null;
  /** Principal-weighted loan term in days. Not rendered on this page. */
  avg_duration_days: number | null;
  /**
   * Σ **outstanding** senior over active loans, USDC base-6 decimal string.
   * **Registry-sourced ⇒ scale ×1000** (`formatRegistryCompactUsd`). Backs
   * the **Deployed senior** tile.
   */
  deployed_senior: string;
  /**
   * Principal-weighted senior interest rate, decimal-fraction string (e.g.
   * `"0.131000"` = 13.1%). Not an amount; do NOT scale. Backs the
   * **Weighted rate** tile. `null` when no loans are active.
   */
  weighted_rate: string | null;
  /** Principal-weighted loan term in days, rounded. Backs the **Weighted tenor** tile. */
  weighted_tenor_days: number | null;
  /**
   * Σ outstanding senior of at-risk (WatchList/Default) loans, USDC base-6
   * decimal string. **Registry-sourced ⇒ scale ×1000.** Backs the
   * **At-risk (WL + Default)** tile's dollar sub-line.
   */
  at_risk_wl_and_default_senior: string;
  /**
   * At-risk senior over whole-book NAV, 4-decimal fraction string (e.g.
   * `"0.0430"` = 4.3%). Backend-computed ratio (mixes a registry-scaled
   * numerator with a correct-scale NAV denominator — see the module doc);
   * rendered as served, no frontend correction is defined for this issue.
   * `null` when no collateral is available. Backs the **At-risk (WL +
   * Default)** tile headline %.
   */
  at_risk_wl_and_default_pct: string | null;
  /** Largest single-commodity exposure by outstanding-senior share. Backs the **Top concentration** tile. */
  top_concentration: TopConcentration | null;
}

/** One row in the active-loan table. */
export interface LoanBookEntry {
  /**
   * On-chain loan id (`SubmissionView.loan_id`), served since the loan/chain-id
   * addition to `GET /v1/loan-book`. Stable row key and the `/loans/$id` route
   * param + the `{loan_id}` path segment for `useLoanValuation`.
   */
  loan_id: string;
  /** Chain the loan lives on (Stellar chain id for the Trustee app). */
  chain_id: number;
  /** Originating party (e.g. `"Open Mineral"`). */
  originator: string;
  /** Borrower identifier. Not rendered on this page. */
  borrower: string;
  /** Underlying commodity (e.g. `"Copper Concentrate"`). */
  commodity: string;
  /** Principal = senior + equity tranche, USDC base-6 decimal string. Not rendered on this page. */
  principal: string;
  /**
   * Outstanding senior, USDC base-6 decimal string. **Registry-sourced ⇒
   * scale ×1000.** Backs the **Senior outst.** column.
   */
  senior_outstanding: string;
  /** Rollover-aware maturity, Unix seconds. Backs the **Maturity** column. */
  maturity: number;
  /**
   * Timestamp the current CCR was last reported on-chain, Unix seconds; `0`
   * when never reported. Backs the CCR staleness age chip.
   */
  ccr_reported_at: number;
  /** Latest spot price of the underlying asset (USD, decimal string). `null` when unpriced. */
  spot_price: string | null;
  /**
   * Trailing 7-day change of the underlying spot price, decimal fraction
   * (e.g. `"-0.1800"` = -18%). `null` when unavailable.
   */
  spot_change_7d: string | null;
  /**
   * Collateral value, USDC base-6 decimal string. Price-feed sourced (#706)
   * ⇒ already correct-scale — do NOT scale. `null` when unpriced. Backs the
   * **Collateral** column.
   */
  collateral: string | null;
  /** Loan-to-value, 4-decimal fraction string. Not rendered on this page. */
  ltv: string | null;
  /**
   * Collateral Coverage Ratio in basis points (`14000` = 140%) =
   * `collateral / outstanding senior`. Backend-computed ratio that mixes
   * correct-scale collateral with registry-scaled (1000× low) senior in the
   * denominator, so this is served **~1000× too big** — see
   * `-useLoansTable.ts`'s `classifyCcr`/CCR mapping for the ÷1000 display
   * correction (resolved Open Question 1, issue #843). `null` when
   * collateral is unavailable. Backs the **CCR** column + pre-default
   * classification.
   */
  ccr_bps: number | null;
  /** Original loan term in days. Not rendered on this page. */
  duration_days: number;
  /** Senior interest rate, decimal-fraction string. Not rendered on this page. */
  rate: string;
  /** Trade-finance protection instrument. Not rendered on this page. */
  protection: string | null;
  /** Loan status from the latest snapshot: `"Performing"`, `"WatchList"`, `"Default"`, `"Closed"`, … */
  status: string;
}

/** Shape of the `GET /v1/loan-book` response (post-#833/#834). */
export interface LoanBookResponse {
  summary: LoanBookSummary;
  /**
   * Active loans only (`origination_date <= now < effective_end`), sorted by
   * principal descending — defaulted/closed loans are excluded (see RISK 2
   * in the exec plan; the Default/Closed tabs render with an empty state,
   * resolved Open Question 2).
   */
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
 * - Always enabled — no wallet connection required (public endpoint), same
 *   as `useLoanSubmissions`.
 * - Always sends `chain_id=ENV.STELLAR_CHAIN_ID` — the Trustee app is
 *   Stellar-scoped like the LP Protocol Dashboard.
 * - Polls every 30 s per the dashboard "Real-time updates" convention
 *   (`docs/FRONTEND.md`).
 */
export function useLoanBook(): UseLoanBookResult {
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
