/**
 * React Query hook — fetches one loan's realized financials from the Pipeline
 * API (`GET /v1/loan-book/{loan_id}/financials`) for the Trustee **Loan detail**
 * page's "Registry state & derived" section (issue #852, Figma node `4116:10549`).
 *
 * Mirrors `useLoanValuation.ts` / `useLoanBook.ts` conventions (queryKey shape,
 * `apiFetch`, `refetchInterval`, Stellar-scoped `chain_id`). Like the rest of the
 * Trustee app it does NOT depend on `@pipeline/frontend` (epic #775), so the
 * types below are a self-contained port of the backend DTO
 * (`packages/api/src/routes/loan_financials.rs`, `LoanFinancialsResponse`) rather
 * than an import — a sixth hand-mirroring alongside TD-42's existing pairs (see
 * `docs/exec-plans/tech-debt-tracker.md`).
 *
 * ## Scale note (issue #852 open question a)
 * The money fields are registry/loan-snapshot-sourced USDC 6-decimal strings, so
 * they are expected to be **1000× too small on the wire** like `senior_outstanding`
 * (issue #840) — the presenter (`-useLoanDetail.ts::buildFinancials`) formats them
 * with the `formatRegistry*` ×1000 helpers. **To be verified against real data**
 * once available; if this endpoint turns out to serve correct-scale amounts (like
 * `/valuations`), drop the ×1000 helpers there.
 */
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { ENV } from "@/lib/env";

// ── Types (port of the backend DTO) ─────────────────────────────────────────

/** Collateral location, projected from the loan snapshot's `current_location`. */
export interface LocationView {
  /** `Vessel`, `Warehouse`, `TankFarm`, `Other`. */
  location_type: string;
  /** Free-form identifier (vessel name, warehouse id, …). */
  location_identifier: string;
  /** Optional external tracking URL; empty string when none. */
  tracking_url: string;
  /** ISO-8601 UTC timestamp of the last location update. */
  updated_at: string;
}

/** Shape of the `GET /v1/loan-book/{loan_id}/financials` response. */
export interface LoanFinancialsResponse {
  loan_id: string;
  /** Loan status (`Performing`, `WatchList`, `Default`, `Closed`). */
  status: string;
  /** Current physical location of the collateral; `null` when never reported. */
  location: LocationView | null;
  /** Original offtaker price (USDC 6-decimal string) — total the offtaker owes. */
  offtaker: string;
  /** Principal deployed: `original_senior_tranche + original_equity_tranche`. */
  principal: string;
  /** Realized senior interest to date (cumulative). */
  interest: string;
  /** Realized fees to date (cumulative mgmt + perf). */
  fees: string;
  /** Yield minted to sPLUSD for this loan's confirmed repayments. */
  minted_yield: string;
  /** Realized interest + fees not yet minted: `(interest + fees) − minted_yield`, ≥ 0. */
  not_minted_yield: string;
  /** Offtaker amount still owed: `offtaker − offtaker_received`. */
  offtaker_outstanding: string;
}

/** Return value of `useLoanFinancials`. */
export interface UseLoanFinancialsResult {
  data: LoanFinancialsResponse | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Returns one loan's realized financials (status, location, recorded counters,
 * offtaker outstanding, unminted yield).
 *
 * - Public endpoint — enabled once a `loanId` is present (disabled while empty so
 *   it never fires on a half-mounted route).
 * - Always sends `chain_id=ENV.STELLAR_CHAIN_ID` — Stellar-scoped, matching
 *   `useLoanBook` / `useLoanValuation`.
 * - Polls every 30 s per the dashboard "Real-time updates" convention.
 */
export function useLoanFinancials(loanId: string): UseLoanFinancialsResult {
  const chainId = ENV.STELLAR_CHAIN_ID;
  const query = useQuery<LoanFinancialsResponse, Error>({
    queryKey: ["loan-financials", chainId, loanId],
    queryFn: () =>
      apiFetch<LoanFinancialsResponse>(
        `/v1/loan-book/${encodeURIComponent(loanId)}/financials?chain_id=${chainId}`,
      ),
    enabled: loanId.length > 0,
    refetchInterval: 30_000,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}
