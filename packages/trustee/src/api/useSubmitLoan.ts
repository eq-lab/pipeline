/**
 * React Query mutation hook — wires the Submit-a-loan form
 * (`/origination/new`, #1100) to `POST /v1/loan-book/loan`.
 *
 * The input types mirror `SubmitLoanRequest` in
 * `packages/api/src/routes/loan_book.rs` field-for-field; amount strings are
 * full-scale 6-decimal strings sent verbatim (no client-side rescaling). The
 * session bearer is attached by `apiFetch` (#791).
 *
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
  /** One of `Vessel`, `Warehouse`, `TankFarm`, `Other`. */
  location_type: string;
  location_identifier: string;
  tracking_url: string;
  updated_at: number;
}

export interface CollateralValuationInput {
  /** One of `StandardGoods`, `MetalConcentrate`. */
  valuation_mode: string;
  asset: string;
  price_provider: string;
  /** Decimal fraction string in `[0, 1]`. */
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
  /** 1e6-scaled; the backend rejects values below 1_000_000. */
  initial_ccr: number;
  initial_location: LocationInput;
  collateral_valuation: CollateralValuationInput;
  fee_schedule: FeeScheduleInput;
}

export interface SubmitLoanResponse {
  /** The `submitted_loans` PK — not an on-chain `loan_id`. */
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
