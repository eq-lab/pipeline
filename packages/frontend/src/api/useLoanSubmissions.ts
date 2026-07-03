/**
 * React Query hook — fetches loan submissions (the "In Origination" pipeline)
 * from the Pipeline API (`GET /v1/loan-book/submissions`).
 *
 * The hook is always enabled (no wallet connection required — this endpoint is
 * public, mirroring `useLoanBook`).
 *
 * No `?status=` filter is sent: the In Origination tab lists *all* submissions
 * (newest first) and surfaces each row's lifecycle status in a Status column.
 *
 * Mock layer
 * ----------
 * Before issuing a real network request, `apiFetch` checks:
 *
 *   `pipeline.mock.api.GET./v1/loan-book/submissions`
 *
 * When the key is present its value is parsed as JSON and returned immediately.
 *
 * See `src/api/README.md` for the full mock-key schema and DevTools snippets.
 *
 * Data-layer note
 * ---------------
 * `loan_data` is the verbatim submitted payload (backend `SubmissionView.loan_data`
 * is a `serde_json::Value`), returned as a **nested JSON object** — not a
 * JSON-encoded string. Its monetary fields (`economics.original_facility_size`,
 * …) are **base-6 decimal strings already in human units** (e.g.
 * `"8000000.000000"` = $8M USDC), same convention as `/v1/loan-book`. Use
 * `formatCompactUsd` — do NOT call `formatUsdc` / `parseUnits` on them.
 */
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Loan economics fixed at origination (mirrors the contract's
 * `ImmutableLoanData`). USDC amounts are base-6 decimal strings in human units.
 */
export interface EconomicsInput {
  /** Total facility size, USDC (6-decimal string). Equals senior + equity. */
  original_facility_size: string;
  /** Senior tranche, USDC (6-decimal string). */
  original_senior_tranche: string;
  /** Equity tranche, USDC (6-decimal string). */
  original_equity_tranche: string;
  /** Offtaker price, USDC (6-decimal string). */
  original_offtaker_price: string;
  /** Senior interest rate in basis points. */
  senior_interest_rate_bps: number;
  /** Origination timestamp (Unix seconds). */
  origination_date: number;
  /** Original maturity timestamp (Unix seconds). */
  original_maturity_date: number;
}

/** Initial collateral location (mirrors the contract's `LocationUpdate`). */
export interface LocationInput {
  /** One of `Vessel`, `Warehouse`, `TankFarm`, `Other`. */
  location_type: string;
  location_identifier: string;
  tracking_url: string;
  /** Report timestamp (Unix seconds). */
  updated_at: number;
}

/**
 * The submitted loan payload — every input required by the on-chain
 * `draw_loan`, persisted verbatim for trustee review (`SubmitLoanRequest`).
 */
export interface SubmitLoanRequest {
  /** Address the soulbound loan token is minted to. */
  to: string;
  metadata_uri: string;
  originator: string;
  borrower_id: string;
  commodity: string;
  corridor: string;
  governing_law: string;
  economics: EconomicsInput;
  /** Initial collateral-coverage ratio (1e6-scaled; `>= 1_000_000`). */
  initial_ccr: number;
  initial_location: LocationInput;
  /** Trade-finance protection instrument (e.g. `"LC at sight"`). */
  protection?: string;
  /** Optional secondary URI inside the metadata document. */
  secondary_metadata_uri?: string | null;
}

/** One submission as returned by `GET /v1/loan-book/submissions`. */
export interface SubmissionView {
  id: number;
  /** Lifecycle status: `"InReview"` | `"Approved"` | `"Rejected"`. */
  status:
    | "InReview"
    | "Approved"
    | "Rejected"
    | (string & Record<never, never>);
  /** Rejection reason; present iff `status === "Rejected"`. */
  reason: string | null;
  /** The submitter (authenticated address). */
  originator: string;
  /** Submission timestamp (RFC 3339). */
  created_at: string;
  /** Last update timestamp (RFC 3339). */
  updated_at: string;
  /** The full submitted payload, passed through verbatim. */
  loan_data: SubmitLoanRequest;
}

/** Return value of `useLoanSubmissions`. */
export interface UseLoanSubmissionsResult {
  data: SubmissionView[] | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Returns loan submissions (the In Origination pipeline), newest first.
 *
 * - Always enabled — no wallet connection required (public endpoint).
 * - Polls every 30 s per the dashboard "Real-time updates" convention
 *   (`docs/FRONTEND.md`).
 * - Returns all statuses; the caller renders each row's `status`.
 */
export function useLoanSubmissions(): UseLoanSubmissionsResult {
  const query = useQuery<SubmissionView[], Error>({
    queryKey: ["loan-submissions"],
    queryFn: () => apiFetch<SubmissionView[]>("/v1/loan-book/submissions"),
    refetchInterval: 30_000,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}
