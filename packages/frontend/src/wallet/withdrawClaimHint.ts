// spec: docs/product-specs/withdrawals.md#queue-position-payable-now-and-recovery-rate-lp-app
import type { RequestStatus } from "@/api";
import { WITHDRAW_CUSTODY_SHORT_MESSAGE } from "@/utils/userError";

export const WITHDRAW_HINT_PAUSED =
  "The withdrawal queue is paused. Check the status page before retrying.";
export const WITHDRAW_HINT_VOUCHER_EXPIRED =
  "The voucher expired before you claimed. Your app fetches a new one.";
export const WITHDRAW_HINT_NO_VOUCHER =
  "No voucher yet. Screening is still running, or the request did not screen clean.";
export const WITHDRAW_HINT_CUSTODY_SHORT = WITHDRAW_CUSTODY_SHORT_MESSAGE;
export const WITHDRAW_HINT_PAYABLE = "Payable now.";
export const WITHDRAW_REQUEST_HINT =
  "A request cannot be cancelled. Your PLUSD stays in the queue until it is claimed.";

export interface WithdrawClaimHintInput {
  paused: boolean | undefined;
  voucherExpired: boolean;
  hasVoucher: boolean;
  requestStatus: RequestStatus | undefined;
  payableNow: boolean | undefined;
  recoveryActive: boolean;
  payout: string | undefined;
  amount: string | undefined;
  rate: string | undefined;
}

export function selectWithdrawClaimHint(
  input: WithdrawClaimHintInput,
): string | undefined {
  if (input.paused === true) return WITHDRAW_HINT_PAUSED;
  if (input.voucherExpired) return WITHDRAW_HINT_VOUCHER_EXPIRED;
  if (
    !input.hasVoucher ||
    input.requestStatus === "PendingVerification" ||
    input.requestStatus === "VerificationFailed"
  ) {
    return WITHDRAW_HINT_NO_VOUCHER;
  }
  if (input.payableNow === false) return WITHDRAW_HINT_CUSTODY_SHORT;
  if (input.payableNow !== true) return undefined;
  if (input.recoveryActive) {
    return `${WITHDRAW_HINT_PAYABLE} Pays ${input.payout ?? "—"} USDC = ${input.amount ?? "—"} PLUSD × ${input.rate ?? "—"}`;
  }
  if (input.payout !== undefined) {
    return `${WITHDRAW_HINT_PAYABLE} Pays ${input.payout} USDC.`;
  }
  return WITHDRAW_HINT_PAYABLE;
}
