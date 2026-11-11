// spec: docs/frontend/trustee-flows.md#draw-inputs-gate-1805
import type { DrawLoanArgs } from "@/api/useLoanSubmissions";
import { truncateAddress } from "@/lib/truncateAddress";

export interface ReadyDrawLoanArgs {
  metadata_uri: string;
  economics: {
    borrower_ref: string;
    original_facility_size: string;
    original_senior_tranche: string;
    original_equity_tranche: string;
    original_offtaker_price: string;
    senior_interest_rate: number;
    origination_date: number;
    original_maturity_date: number;
  };
}

const BORROWER_REF_HEX = /^[0-9a-fA-F]{64}$/;

export function readyDrawLoanArgs(
  served: DrawLoanArgs | null | undefined,
): ReadyDrawLoanArgs | null {
  if (!served || served.missing_inputs.length > 0) return null;
  const { metadata_uri: uri, economics: e } = served;
  if (
    uri == null ||
    e.borrower_ref == null ||
    e.original_facility_size == null ||
    e.original_senior_tranche == null ||
    e.original_equity_tranche == null ||
    e.original_offtaker_price == null ||
    e.senior_interest_rate == null ||
    e.origination_date == null ||
    e.original_maturity_date == null
  ) {
    return null;
  }
  return {
    metadata_uri: uri,
    economics: {
      borrower_ref: e.borrower_ref,
      original_facility_size: e.original_facility_size,
      original_senior_tranche: e.original_senior_tranche,
      original_equity_tranche: e.original_equity_tranche,
      original_offtaker_price: e.original_offtaker_price,
      senior_interest_rate: e.senior_interest_rate,
      origination_date: e.origination_date,
      original_maturity_date: e.original_maturity_date,
    },
  };
}

export function drawLoanBlockedReason(
  served: DrawLoanArgs | null | undefined,
): string | null {
  if (!served) {
    return "On-chain draw inputs are not available for this submission. Reject or request changes instead.";
  }
  if (served.missing_inputs.includes("data_room_id")) {
    return "Data room ID missing — this submission can't be drawn on-chain. Request changes so it is resubmitted with a data room ID, or reject it.";
  }
  if (served.missing_inputs.length > 0) {
    return `On-chain draw inputs missing: ${served.missing_inputs.join(", ")}. Request changes so it is resubmitted through the current form, or reject it.`;
  }
  return readyDrawLoanArgs(served)
    ? null
    : "On-chain draw inputs are not available for this submission. Reject or request changes instead.";
}

export function borrowerRefFull(
  served: DrawLoanArgs | null | undefined,
): string | null {
  const ref = served?.economics.borrower_ref;
  return ref && BORROWER_REF_HEX.test(ref) ? ref : null;
}

export function formatBorrowerRef(
  served: DrawLoanArgs | null | undefined,
): string {
  const full = borrowerRefFull(served);
  if (full) return truncateAddress(full);
  if (served?.missing_inputs.includes("data_room_id")) {
    return "Data room ID missing";
  }
  return "—";
}
