// spec: docs/frontend/trustee-flows.md#cash-management--conversions-and-bank-charges
import {
  parseUsdDollarsToI128,
  type CanCall,
  type MinterRamp,
  type RampDirection,
} from "@pipeline/wallet-connect";
import type { ConversionFn } from "@/api/useConversions";
import {
  REUSED_BANK_REFERENCE_COPY,
  WIRE_OUT_REFERENCE_MAX,
  rawToDecimal7,
} from "@/lib/wireOut";
import {
  parseSorobanContractErrorCode,
  toUserError,
  type UserFacingError,
} from "@/utils/userError";

export const RAMP_DIRECTION_LABEL: Record<RampDirection, string> = {
  UsdcToBank: "USDC → USD",
  BankToUsdc: "USD → USDC",
};

export const RAMP_DIRECTION_EFFECT: Record<RampDirection, string> = {
  UsdcToBank:
    "Books USDC sent from custody to the bank as cash in transit. The custody balance must cover it.",
  BankToUsdc: "Takes the amount out of booked bank cash into cash in transit.",
};

export const CLOSE_SHORTFALL_COPY =
  "Any shortfall between the opened amount and the amount received is booked by the contract as an expense and absorbed by the vault.";

export type RampChainState =
  | "reading"
  | "read-error"
  | "confirmed"
  | "closed-pending-index"
  | "mismatch";

export interface ConversionAccessInput {
  access: CanCall | undefined;
  isPending: boolean;
  isError: boolean;
}

const ROLE_COPY: Record<ConversionFn, string> = {
  open_ramp: "Only the Trustee role can open conversions.",
  close_ramp: "Only the Trustee role can close conversions.",
  record_expense: "Only the Trustee role can record bank charges.",
};

export function conversionAccessReason(
  fn: ConversionFn,
  { access, isPending, isError }: ConversionAccessInput,
): string | null {
  if (access?.immediate) return null;
  if (isPending) return "Checking this wallet's Trustee role…";
  if (isError || !access) return "Could not verify this wallet's Trustee role.";
  if (access.delay > 0) {
    return `This wallet holds the Trustee role with a ${access.delay / 3600} h delay; the app does not schedule cash-book bookings.`;
  }
  return ROLE_COPY[fn];
}

export interface RampChainRead {
  data: MinterRamp | undefined;
  isPending: boolean;
  isError: boolean;
}

export function rampRowState(
  servedStatus: string,
  chain: RampChainRead,
): RampChainState {
  if (chain.isError) return "read-error";
  if (!chain.data) return chain.isPending ? "reading" : "read-error";
  if (!chain.data.closed) return "confirmed";
  return servedStatus === "Open" ? "closed-pending-index" : "mismatch";
}

export function rampStateLabel(state: RampChainState): string {
  switch (state) {
    case "confirmed":
      return "Open (confirmed on-chain)";
    case "closed-pending-index":
      return "Closed on-chain — waiting for the indexer";
    case "mismatch":
      return "On-chain status differs from the cash book";
    case "read-error":
      return "Could not confirm on-chain";
    case "reading":
      return "Confirming on-chain…";
  }
}

export function rampStateReason(state: RampChainState): string | null {
  switch (state) {
    case "confirmed":
      return null;
    case "reading":
      return "Confirming this conversion on-chain…";
    case "read-error":
      return "Could not confirm this conversion on-chain. Try again shortly.";
    case "closed-pending-index":
      return "Submitted — waiting for the indexer to update this list.";
    case "mismatch":
      return "This conversion's on-chain status differs from the cash book.";
  }
}

export function parseReceivedRaw(input: string): bigint | null {
  const trimmed = input.trim();
  if (/^0+(\.0{1,7})?$/.test(trimmed)) return 0n;
  try {
    return parseUsdDollarsToI128(trimmed);
  } catch {
    return null;
  }
}

function amountValid(input: string): boolean {
  try {
    parseUsdDollarsToI128(input);
    return true;
  } catch {
    return false;
  }
}

function referenceError(reference: string, empty: string): string | null {
  const trimmed = reference.trim();
  if (trimmed === "") return empty;
  if (trimmed.length > WIRE_OUT_REFERENCE_MAX) {
    return `The reference can be at most ${WIRE_OUT_REFERENCE_MAX} characters.`;
  }
  return null;
}

export interface OpenFormInput {
  direction: RampDirection | null;
  amountInput: string;
  reference: string;
}

export function openFormError({
  direction,
  amountInput,
  reference,
}: OpenFormInput): string | null {
  if (direction === null) return "Choose a direction.";
  if (!amountValid(amountInput)) return "Enter the amount to convert.";
  return referenceError(reference, "Enter the transfer reference.");
}

export interface CloseFormInput {
  receivedInput: string;
  amountRaw: string;
  reference: string;
}

export function closeFormError({
  receivedInput,
  amountRaw,
  reference,
}: CloseFormInput): string | null {
  const received = parseReceivedRaw(receivedInput);
  if (received === null) return "Enter the amount received.";
  if (received > BigInt(amountRaw)) {
    return `The amount received cannot exceed the opened amount (${rawToDecimal7(amountRaw)}).`;
  }
  return referenceError(reference, "Enter the closing reference.");
}

export interface ExpenseFormInput {
  amountInput: string;
  valueDateInput: string;
  today: string;
  reference: string;
}

export function expenseFormError({
  amountInput,
  valueDateInput,
  today,
  reference,
}: ExpenseFormInput): string | null {
  if (!amountValid(amountInput)) return "Enter the charge amount.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valueDateInput)) {
    return "Enter the value date.";
  }
  if (valueDateInput > today) return "The value date cannot be in the future.";
  return referenceError(reference, "Enter the bank reference.");
}

const FALLBACK_COPY: Record<ConversionFn, string> = {
  open_ramp: "Could not open this conversion. Please try again.",
  close_ramp: "Could not close this conversion. Please try again.",
  record_expense: "Could not record this bank charge. Please try again.",
};

export function conversionErrorCopy(
  fn: ConversionFn,
  err: unknown,
): UserFacingError {
  const mapped = toUserError(err, FALLBACK_COPY[fn]);
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
  if (/RefHashSeen/i.test(mapped.details) || code === 7) {
    return specific(REUSED_BANK_REFERENCE_COPY);
  }
  if (
    fn === "open_ramp" &&
    (/EnforcedPause/i.test(mapped.details) || code === 1000)
  ) {
    return specific(
      "The minter is paused. Conversions cannot be opened until it is unpaused.",
    );
  }
  if (code === 8) {
    return specific("The minter's booked bank cash is below this amount.");
  }
  if (fn === "open_ramp" && code === 18) {
    return specific("Custody USDC on-chain is below this amount.");
  }
  if (code === 19) {
    return specific("The amount received cannot exceed the opened amount.");
  }
  if (code === 20) {
    return specific("This conversion is already closed. Refresh the list.");
  }
  if (code === 11) {
    return specific("The minter has no conversion with this id.");
  }
  if (code === 6) return specific("The amount must be greater than zero.");
  return mapped;
}
