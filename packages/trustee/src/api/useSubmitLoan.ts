/**
 * POST /v1/loan-book/loan mutation — types mirror SubmitLoanRequest in
 * packages/api/src/routes/loan_book.rs.
 * spec: docs/frontend/trustee-flows.md#submit-a-loan-originationnew-1100.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";

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

export interface CollateralValuationInput {
  valuation_mode: string;
  asset: string;
  price_provider: string;
  haircut_pct: string;
  quantity_dmt: string;
}

export interface FeeScheduleInput {
  mgmt_fee_rate_bps: number;
  perf_fee_rate_bps: number;
  oet_alloc_rate_bps: number;
}

export interface LoanDocumentInput {
  name: string;
  uri: string;
}

export interface SubmitLoanInput {
  to: string;
  metadata_uri: string;
  originator: string;
  borrower_id: string;
  commodity: string;
  corridor: string;
  governing_law: string;
  protection: string;
  secondary_metadata_uri?: string;
  documents: LoanDocumentInput[];
  economics: EconomicsInput;
  initial_ccr: number;
  initial_location: LocationInput;
  collateral_valuation: CollateralValuationInput;
  fee_schedule: FeeScheduleInput;
}

export interface SubmitLoanResponse {
  id: number;
}

async function postLoan(input: SubmitLoanInput): Promise<SubmitLoanResponse> {
  return apiFetch<SubmitLoanResponse>("/v1/loan-book/loan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function useSubmitLoan() {
  const queryClient = useQueryClient();

  return useMutation<SubmitLoanResponse, Error, SubmitLoanInput>({
    mutationFn: postLoan,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["loan-submissions"] });
    },
  });
}
