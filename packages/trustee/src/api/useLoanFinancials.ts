/**
 * React Query hook — fetches one loan's realized financials
 * (`GET /v1/loan-book/{loan_id}/financials`) for the Trustee Loan detail
 * page's "Registry state & derived" section.
 *
 * spec: docs/frontend/trustee-flows.md#registry-state--derived-852 (scale
 * note, TD-42 hand-mirroring).
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

/** The loan's current epoch (genesis or latest rollover/amend). */
export interface Epoch {
  /** 1-based epoch number. */
  number: number;
  /** Current senior APY in basis points (`1000` = 10.0%). */
  current_apy_bps: number;
  /** Epoch start, RFC-3339 UTC timestamp. */
  start_date: string;
  /** Epoch maturity, RFC-3339 UTC timestamp. */
  maturity_date: string;
}

/** Shape of the `GET /v1/loan-book/{loan_id}/financials` response. */
export interface LoanFinancialsResponse {
  loan_id: string;
  /** Loan status (`Performing`, `WatchList`, `Default`, `Closed`). */
  status: string;
  /** Current physical location of the collateral; `null` when never reported. */
  location: LocationView | null;
  /** Current epoch (number · APY · start → maturity); `null` when none on record. */
  epoch: Epoch | null;
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
