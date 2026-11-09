// spec: docs/frontend/trustee-flows.md#cash-reporter-bookings
import type { CanCall } from "@pipeline/wallet-connect";

export type CashReporterFn = "record_wire_in" | "repay" | "record_income";

export const CASH_REPORTER_NO_ROLE: Record<CashReporterFn, string> = {
  record_wire_in: "Only the Cash reporter can book incoming wires.",
  repay: "Only the Cash reporter can book repayments.",
  record_income: "Only the Cash reporter can book bank income.",
};

export function cashReporterReason(
  fn: CashReporterFn,
  state: { access?: CanCall; isPending: boolean; isError: boolean },
): string | null {
  if (state.access?.immediate) return null;
  if (state.isError) {
    return "Could not verify this wallet's Cash reporter role.";
  }
  if (state.isPending || !state.access) {
    return "Checking this wallet's Cash reporter role…";
  }
  if (state.access.delay > 0) {
    return `This wallet holds the Cash reporter role with a ${state.access.delay / 3600} h delay; the minter accepts only immediate calls.`;
  }
  return CASH_REPORTER_NO_ROLE[fn];
}
