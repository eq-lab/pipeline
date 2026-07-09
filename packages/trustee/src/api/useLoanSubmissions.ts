/**
 * React Query hook — fetches loan submissions (the "In Origination" pipeline)
 * from the Pipeline API (`GET /v1/loan-book/submissions`) for the Trustee
 * Origination page (issue #813).
 *
 * Mirrors the LP frontend's `useLoanSubmissions` conventions (queryKey shape,
 * `apiFetch`, `refetchInterval`) — see
 * `packages/frontend/src/api/useLoanSubmissions.ts` — and the trustee's own
 * `useCapitalAllocation.ts` (Stellar-scoped `chain_id`, 30 s poll). The
 * trustee app deliberately does NOT depend on `@pipeline/frontend` (epic #775
 * keeps the two apps separate), so the types below are a self-contained port
 * rather than an import. See `docs/exec-plans/tech-debt-tracker.md` TD-42 for
 * the cross-package consolidation debt this duplication creates (also
 * flagged for #814, the Protocol Dashboard's In-Origination tab, which reads
 * the same endpoint).
 *
 * Data-layer note
 * ---------------
 * `loan_data` is the verbatim submitted payload (backend `SubmissionView.loan_data`
 * is a `serde_json::Value`), returned as a **nested JSON object** — not a
 * JSON-encoded string. Its monetary fields (`economics.original_facility_size`,
 * …) are **base-6 decimal strings already in human units** (e.g.
 * `"3500000.000000"` = $3,500,000), same convention as `/v1/loan-book`. Use
 * `formatFullUsd` — do NOT call `formatUsdc` / `parseUnits` on them. Because
 * the wire type is `serde_json::Value`, callers must defensively handle
 * missing/malformed nested fields and render `—` (never fabricate).
 */
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { ENV } from "@/lib/env";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Loan economics fixed at origination (mirrors the contract's
 * `ImmutableLoanData`). USDC amounts are base-6 decimal strings in human
 * units. `senior_interest_rate_bps` is basis points; the two date fields are
 * Unix seconds.
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

/**
 * A single document reference (name + URI) from the loan metadata document
 * (backend `LoanDocumentDto`, `loan_book.rs:123`).
 */
export interface LoanDocumentDto {
  name: string;
  uri: string;
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
  /**
   * Documents referenced in the submitted metadata (Agreement, License,
   * T&Cs, …), lifted by the backend from `loan_data.documents` for direct
   * consumption (`loan_book.rs:233-235`). Empty for legacy submissions that
   * predate the field — render a graceful empty state, never fabricate.
   */
  documents: LoanDocumentDto[];
  /**
   * The full submitted payload, passed through verbatim by the backend as
   * `serde_json::Value` — treat as loosely-typed at the boundary even though
   * it is declared as `SubmitLoanRequest` here (matching the LP convention).
   */
  loan_data: SubmitLoanRequest;
}

/** Return value of `useLoanSubmissions`. */
export interface UseLoanSubmissionsResult {
  data: SubmissionView[] | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Narrow status filter accepted by `useLoanSubmissions`. Mirrors the known
 * `SubmissionView["status"]` literals (not `string`) — the backend's
 * `SubmissionsQuery.status` 400s on unknown values, so widening this would
 * let a bad filter silently reach the API.
 */
export type SubmissionStatusFilter = "InReview" | "Approved" | "Rejected";

/** Options accepted by `useLoanSubmissions`. */
export interface UseLoanSubmissionsOptions {
  /**
   * Server-side status filter (`&status=<value>` on the request). Omit for
   * today's default behavior — all statuses, unchanged query key — so
   * existing callers (e.g. `useOriginationTable`, issue #813) are unaffected.
   */
  status?: SubmissionStatusFilter;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Returns loan submissions (the In Origination pipeline), newest first.
 *
 * - Always enabled — no wallet connection required (public endpoint), same
 *   as `useCapitalAllocation`.
 * - Always sends `chain_id=ENV.STELLAR_CHAIN_ID` — the Trustee app is
 *   Stellar-scoped like the LP Protocol Dashboard.
 * - Polls every 30 s per the dashboard "Real-time updates" convention
 *   (`docs/FRONTEND.md`).
 * - Returns all statuses by default; the caller renders each row's `status`.
 * - Optional `status` filter (issue #818): appends `&status=<value>` to the
 *   request URL — a real server-side filter (`packages/api/src/routes/loan_book.rs`'s
 *   `SubmissionsQuery.status`), not a client-side one — and is included in the
 *   query key (`["loan-submissions", chainId, status ?? "all"]`) so filtered
 *   and unfiltered variants cache independently. Omitting `status` preserves
 *   the pre-#818 behavior exactly.
 */
export function useLoanSubmissions(
  options?: UseLoanSubmissionsOptions,
): UseLoanSubmissionsResult {
  const chainId = ENV.STELLAR_CHAIN_ID;
  const status = options?.status;
  const query = useQuery<SubmissionView[], Error>({
    queryKey: ["loan-submissions", chainId, status ?? "all"],
    queryFn: () =>
      apiFetch<SubmissionView[]>(
        `/v1/loan-book/submissions?chain_id=${chainId}${
          status ? `&status=${status}` : ""
        }`,
      ),
    refetchInterval: 30_000,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}
