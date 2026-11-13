// spec: docs/frontend/hooks.md (useLoanSubmissions)
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EconomicsInput {
  original_facility_size: string;
  original_senior_tranche: string;
  original_equity_tranche: string;
  original_offtaker_price: string;
  senior_interest_rate_bps: number;
  origination_date: number;
  original_maturity_date: number;
}

export interface LocationInput {
  location_type: string;
  location_identifier: string;
  tracking_url: string;
  updated_at: number;
}

export interface SubmitLoanRequest {
  to: string;
  metadata_uri: string;
  originator: string;
  borrower_id: string;
  commodity: string;
  corridor: string;
  governing_law: string;
  economics: EconomicsInput;
  initial_location: LocationInput;
  protection?: string;
  secondary_metadata_uri?: string | null;
}

export type OriginationSubmissionStatus =
  | "InReview"
  | "Approved"
  | "Rejected"
  | "ChangesRequested";

export function normalizeOriginationSubmissionStatus(
  status: SubmissionView["status"],
): OriginationSubmissionStatus {
  if (status === "InReview") return "InReview";
  if (status === "Rejected") return "Rejected";
  if (status === "ChangesRequested") return "ChangesRequested";
  return "Approved";
}

export interface SubmissionView {
  id: number;
  status:
    | "InReview"
    | "Approved"
    | "Rejected"
    | "ChangesRequested"
    | (string & Record<never, never>);
  reason: string | null;
  originator: string;
  target_chain_id: number;
  chain_id: number | null;
  loan_id: string | null;
  created_at: string;
  updated_at: string;
  loan_data: SubmitLoanRequest;
}

export interface UseLoanSubmissionsResult {
  data: SubmissionView[] | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

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
