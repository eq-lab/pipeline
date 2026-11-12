// spec: docs/frontend/trustee-flows.md#disburse-1898
import {
  parseUsdDollarsToI128,
  type CanCall,
  type LoanDisbursementState,
} from "@pipeline/wallet-connect";
import {
  REUSED_BANK_REFERENCE_COPY,
  WIRE_OUT_REFERENCE_MAX,
  rawToDecimal7,
} from "@/lib/wireOut";
import { stellarOnlyActionReason } from "@/lib/targetChains";
import { formatUsdExact } from "@/utils/formatUsd";
import {
  parseSorobanContractErrorCode,
  toUserError,
  type UserFacingError,
} from "@/utils/userError";

export const DISBURSE_NOT_CONFIGURED =
  "Disbursement isn't configured for this environment.";
export const DISBURSE_CONNECT_WALLET =
  "Connect your trustee wallet to disburse this loan.";
export const DISBURSE_NO_ROLE = "Only the Trustee role can disburse a loan.";
export const DEBT_NOT_REGISTERED = "Register this loan's debt token first.";
export const MINTER_PAUSED =
  "The minter is paused. Loans cannot be disbursed until it is unpaused.";
export const REUSED_DISBURSE_REFERENCE = REUSED_BANK_REFERENCE_COPY;

export function debtTrustlineMissing(holder: string): string {
  return `The loan NFT holder ${holder} has no DEBT trustline. Operations must add the DEBT trustline for this loan before it can be disbursed.`;
}

export interface DisburseQuery<T> {
  data: T | undefined;
  isPending: boolean;
  isError: boolean;
}

export interface DebtTrustlineRead {
  holder: string;
  trustline: "present" | "missing";
}

export interface DisburseViewInput {
  chainId: number | null | undefined;
  configured: boolean;
  connected: boolean;
  loan: DisburseQuery<LoanDisbursementState>;
  deal: DisburseQuery<{ debt: string } | null>;
  trustline: DisburseQuery<DebtTrustlineRead>;
  paused: DisburseQuery<boolean>;
  access: DisburseQuery<CanCall>;
}

export type DisburseView =
  | { kind: "hidden" }
  | { kind: "blocked"; reason: string }
  | { kind: "ready" };

const DISBURSABLE_STATUSES: readonly string[] = [
  "Approved",
  "Performing",
  "WatchList",
];

function blocked(reason: string): DisburseView {
  return { kind: "blocked", reason };
}

export function loanAcceptsDisbursement(loan: LoanDisbursementState): boolean {
  return (
    DISBURSABLE_STATUSES.includes(loan.status) &&
    !loan.carvedOut &&
    BigInt(loan.disbursed) < BigInt(loan.originalSeniorTranche)
  );
}

export function disburseView(input: DisburseViewInput): DisburseView {
  const chainReason = stellarOnlyActionReason(input.chainId);
  if (chainReason) return blocked(chainReason);
  if (!input.configured) return blocked(DISBURSE_NOT_CONFIGURED);
  if (input.loan.isError) return blocked("Could not read this loan on-chain.");
  if (input.loan.isPending || !input.loan.data) return { kind: "hidden" };
  if (!loanAcceptsDisbursement(input.loan.data)) return { kind: "hidden" };

  const { deal, trustline, paused, access } = input;
  if (deal.isError) return blocked("Could not read this loan's debt token.");
  if (deal.isPending || deal.data === undefined) {
    return blocked("Checking the debt token…");
  }
  if (deal.data === null) return blocked(DEBT_NOT_REGISTERED);

  if (trustline.isError) {
    return blocked("Could not verify the DEBT trustline of the loan holder.");
  }
  if (trustline.isPending || !trustline.data) {
    return blocked("Checking the DEBT trustline of the loan holder…");
  }
  if (trustline.data.trustline === "missing") {
    return blocked(debtTrustlineMissing(trustline.data.holder));
  }

  if (paused.isError)
    return blocked("Could not check whether the minter is paused.");
  if (paused.isPending || paused.data === undefined) {
    return blocked("Checking whether the minter is paused…");
  }
  if (paused.data) return blocked(MINTER_PAUSED);

  if (!input.connected) return blocked(DISBURSE_CONNECT_WALLET);
  if (access.isError) {
    return blocked("Could not verify this wallet's Trustee role.");
  }
  if (access.isPending || !access.data) {
    return blocked("Checking this wallet's Trustee role…");
  }
  if (access.data.immediate) return { kind: "ready" };
  if (access.data.delay > 0) {
    return blocked(
      `This wallet holds the Trustee role with a ${access.data.delay / 3600} h delay; the app does not schedule disbursements.`,
    );
  }
  return blocked(DISBURSE_NO_ROLE);
}

export interface DisburseFormInput {
  amountInput: string;
  bankCashRaw: string | null;
  valueDateInput: string;
  today: string;
  reference: string;
}

export function disburseFormError({
  amountInput,
  bankCashRaw,
  valueDateInput,
  today,
  reference,
}: DisburseFormInput): string | null {
  let amount: bigint;
  try {
    amount = parseUsdDollarsToI128(amountInput);
  } catch {
    return "Enter the amount disbursed (up to 7 decimals).";
  }
  if (amount <= 0n) return "Enter the amount disbursed (up to 7 decimals).";
  if (bankCashRaw !== null && amount > BigInt(bankCashRaw)) {
    return `The minter's booked bank cash (${formatUsdExact(rawToDecimal7(bankCashRaw))}) is below this amount. Book the incoming wires first.`;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valueDateInput)) {
    return "Enter the value date.";
  }
  if (valueDateInput > today) return "The value date cannot be in the future.";
  const trimmed = reference.trim();
  if (trimmed === "") return "Enter the bank reference of the wire.";
  if (trimmed.length > WIRE_OUT_REFERENCE_MAX) {
    return `The reference can be at most ${WIRE_OUT_REFERENCE_MAX} characters.`;
  }
  return null;
}

export interface DisburseErrorContext {
  disbursed?: string;
  originalSeniorTranche?: string;
}

export function disburseErrorCopy(
  err: unknown,
  { disbursed, originalSeniorTranche }: DisburseErrorContext = {},
): UserFacingError {
  const mapped = toUserError(
    err,
    "Could not disburse this loan. Please try again.",
  );
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
  if (/EnforcedPause/i.test(mapped.details) || code === 1000) {
    return specific(MINTER_PAUSED);
  }
  if (/RefHashSeen/i.test(mapped.details) || code === 7) {
    return specific(REUSED_DISBURSE_REFERENCE);
  }
  if (code === 8) {
    return specific(
      "The minter's booked bank cash is below this amount. Book the incoming wires first.",
    );
  }
  if (code === 6 || code === 25) {
    return specific("The amount must be greater than zero.");
  }
  if (code === 13) {
    const detail =
      disbursed !== undefined && originalSeniorTranche !== undefined
        ? ` (${formatUsdExact(rawToDecimal7(disbursed))} of ${formatUsdExact(rawToDecimal7(originalSeniorTranche))} already disbursed)`
        : "";
    return specific(`This exceeds the loan's senior tranche${detail}.`);
  }
  if (code === 3 || code === 2) {
    return specific(
      "This loan's on-chain status does not allow a disbursement.",
    );
  }
  if (code === 21) {
    return specific("This loan is carved out and cannot be disbursed.");
  }
  return mapped;
}
