// spec: docs/frontend/trustee-flows.md#cash-management--bank-wire-outs
import {
  parseUsdDollarsToI128,
  type CanCall,
  type WireOutRecord,
} from "@pipeline/wallet-connect";
import type { WireOutFn } from "@/api/useWireOuts";
import {
  parseSorobanContractErrorCode,
  toUserError,
  type UserFacingError,
} from "@/utils/userError";

export const WIRE_OUT_REFERENCE_MAX = 140;
export const NOT_PENDING_COPY =
  "This wire-out is no longer pending. Refresh the list.";
export const LP_NOT_AUTHORIZED_COPY =
  "This lender's address is not authorised to hold PLUSD, so the PLUSD cannot be returned.";
export const REUSED_BANK_REFERENCE_COPY =
  "This bank reference is already recorded on-chain. Use the outgoing wire's own reference.";

export type WireOutChainState =
  | "reading"
  | "read-error"
  | "confirmed"
  | "settled-pending-index"
  | "cancelled-pending-index"
  | "mismatch";

export interface WireOutAccessInput {
  access: CanCall | undefined;
  isPending: boolean;
  isError: boolean;
}

export function wireOutAccessReason(
  fn: WireOutFn,
  { access, isPending, isError }: WireOutAccessInput,
): string | null {
  if (access?.immediate) return null;
  if (isPending) return "Checking this wallet's Trustee role…";
  if (isError || !access) return "Could not verify this wallet's Trustee role.";
  if (access.delay > 0) {
    return `This wallet holds the Trustee role with a ${access.delay / 3600} h delay; the app does not schedule wire-out settlements.`;
  }
  return fn === "settle_wire_out"
    ? "Only the Trustee role can settle bank wire-outs."
    : "Only the Trustee role can cancel bank wire-outs.";
}

export interface WireOutChainRead {
  data: WireOutRecord | undefined;
  isPending: boolean;
  isError: boolean;
}

export function wireOutRowState(
  servedStatus: string,
  chain: WireOutChainRead,
): WireOutChainState {
  if (chain.isError) return "read-error";
  if (!chain.data) return chain.isPending ? "reading" : "read-error";
  const status = chain.data.status;
  if (status === "Pending") return "confirmed";
  if (servedStatus === "Pending" && status === "Settled") {
    return "settled-pending-index";
  }
  if (servedStatus === "Pending" && status === "Cancelled") {
    return "cancelled-pending-index";
  }
  return "mismatch";
}

export function wireOutStateLabel(
  state: WireOutChainState,
  chainStatus: string | undefined,
): string {
  switch (state) {
    case "confirmed":
      return "Pending (confirmed on-chain)";
    case "settled-pending-index":
      return "Settled on-chain — waiting for the indexer";
    case "cancelled-pending-index":
      return "Cancelled on-chain — waiting for the indexer";
    case "mismatch":
      return `On-chain status ${chainStatus ?? "unknown"} differs from the cash book`;
    case "read-error":
      return "Could not confirm on-chain";
    case "reading":
      return "Confirming on-chain…";
  }
}

export function wireOutStateReason(
  state: WireOutChainState,
  chainStatus: string | undefined,
): string | null {
  switch (state) {
    case "confirmed":
      return null;
    case "reading":
      return "Confirming this wire-out on-chain…";
    case "read-error":
      return "Could not confirm this wire-out on-chain. Try again shortly.";
    case "settled-pending-index":
    case "cancelled-pending-index":
      return "Submitted — waiting for the indexer to update this list.";
    case "mismatch":
      return `This wire-out is ${chainStatus ?? "no longer pending"} on-chain, not pending.`;
  }
}

export function rawToDecimal7(raw: string): string {
  const digits = raw.replace(/^0+(?=\d)/, "").padStart(8, "0");
  const whole = digits.slice(0, -7);
  const fraction = digits.slice(-7).replace(/0+$/, "");
  return fraction === "" ? whole : `${whole}.${fraction}`;
}

export function valueDateSeconds(dateInput: string): number {
  return Date.parse(`${dateInput}T00:00:00Z`) / 1000;
}

export function todayUtcDateInput(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export interface SettleFormInput {
  amountInput: string;
  amountRaw: string;
  valueDateInput: string;
  today: string;
  reference: string;
}

function amountMatches(amountInput: string, amountRaw: string): boolean | null {
  try {
    return parseUsdDollarsToI128(amountInput) === BigInt(amountRaw);
  } catch {
    return null;
  }
}

export function settleFormError({
  amountInput,
  amountRaw,
  valueDateInput,
  today,
  reference,
}: SettleFormInput): string | null {
  const matches = amountMatches(amountInput, amountRaw);
  if (matches === null) return "Enter the amount wired.";
  if (!matches) {
    return `The minter settles only the full requested amount (${rawToDecimal7(amountRaw)} PLUSD). If a different amount was wired, cancel this request instead.`;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valueDateInput)) {
    return "Enter the value date.";
  }
  if (valueDateInput > today) return "The value date cannot be in the future.";
  const trimmed = reference.trim();
  if (trimmed === "") return "Enter the outgoing wire's bank reference.";
  if (trimmed.length > WIRE_OUT_REFERENCE_MAX) {
    return `The reference can be at most ${WIRE_OUT_REFERENCE_MAX} characters.`;
  }
  return null;
}

export function wireOutErrorCopy(fn: WireOutFn, err: unknown): UserFacingError {
  const fallback =
    fn === "settle_wire_out"
      ? "Could not settle this wire-out. Please try again."
      : "Could not cancel this wire-out. Please try again.";
  const mapped = toUserError(err, fallback);
  const isRejection = /^You cancelled the transaction/.test(mapped.message);
  if (
    isRejection ||
    (mapped.isSpecific && !/simulation error/i.test(mapped.details))
  ) {
    return mapped;
  }
  const code = parseSorobanContractErrorCode(mapped.details);
  const specific = (message: string): UserFacingError => ({
    message,
    details: mapped.details,
    isSpecific: true,
  });
  if (
    fn === "settle_wire_out" &&
    (/RefHashSeen/i.test(mapped.details) || code === 7)
  ) {
    return specific(REUSED_BANK_REFERENCE_COPY);
  }
  if (fn === "settle_wire_out" && code === 17) {
    return specific("The minter settles only the full requested amount.");
  }
  if (fn === "settle_wire_out" && code === 8) {
    return specific(
      "The minter's bank cash is below this amount. Book the incoming wires first.",
    );
  }
  if (fn === "cancel_wire_out" && code === 16) {
    return specific(LP_NOT_AUTHORIZED_COPY);
  }
  if (code === 14) return specific(NOT_PENDING_COPY);
  if (code === 10) return specific("The minter has no wire-out with this id.");
  return mapped;
}
