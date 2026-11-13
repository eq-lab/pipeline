// spec: docs/frontend/account-page.md#settlement-bank-account-1885
import { ApiError } from "@/api";
import type {
  SettlementBankAccountInput,
  SettlementBankAccountSummary,
} from "@/api";

export const BANK_FIELDS = [
  "account_holder_name",
  "bank_name",
  "bank_address",
  "iban",
  "account_number",
  "swift_bic_code",
  "routing_number",
] as const;

export type BankField = (typeof BANK_FIELDS)[number];
export type BankDraft = Record<BankField, string>;

export const BANK_FIELD_LABELS: Record<BankField, string> = {
  account_holder_name: "Account holder name",
  bank_name: "Bank name",
  bank_address: "Bank address (optional)",
  iban: "IBAN",
  account_number: "Account number",
  swift_bic_code: "SWIFT/BIC code",
  routing_number: "Routing number (ABA)",
};

export const EMPTY_BANK_DRAFT: BankDraft = {
  account_holder_name: "",
  bank_name: "",
  bank_address: "",
  iban: "",
  account_number: "",
  swift_bic_code: "",
  routing_number: "",
};

export function bankDraftDirty(draft: BankDraft): boolean {
  return BANK_FIELDS.some((field) => draft[field].trim() !== "");
}

function orNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function bankDraftPayload(draft: BankDraft): SettlementBankAccountInput {
  return {
    account_holder_name: draft.account_holder_name.trim(),
    bank_name: draft.bank_name.trim(),
    bank_address: orNull(draft.bank_address),
    account_number: orNull(draft.account_number),
    iban: orNull(draft.iban),
    swift_bic_code: orNull(draft.swift_bic_code),
    routing_number: orNull(draft.routing_number),
  };
}

function shortLabel(field: BankField): string {
  return BANK_FIELD_LABELS[field].replace(/ \((optional|ABA)\)$/, "");
}

const REASON_COPY: Record<string, (field: BankField) => string> = {
  "is required": (field) => `${shortLabel(field)} is required.`,
  "is too long": (field) =>
    field === "bank_address"
      ? "Bank address is too long (280 characters max)."
      : `${shortLabel(field)} is too long (140 characters max).`,
  "is not a valid IBAN": () => "Enter a valid IBAN.",
  "is not a valid account number": () =>
    "Enter a valid account number (letters and digits only).",
  "is not a valid SWIFT/BIC code": () =>
    "Enter a valid SWIFT/BIC code (8 or 11 characters).",
  "is not a valid routing number": () =>
    "Enter a valid 9-digit ABA routing number.",
  "or iban is required": () => "Enter an IBAN or an account number.",
  "or routing_number is required": () =>
    "Enter a SWIFT/BIC code or a routing number.",
};

const ERROR_PATTERN = /^settlement_bank_account\.([a-z_]+): (.+)$/;

export function parseBankAccountError(
  error: unknown,
): { field: BankField; message: string } | null {
  if (!(error instanceof ApiError) || error.status !== 400) return null;
  const match = ERROR_PATTERN.exec(error.message);
  if (!match) return null;
  const field = BANK_FIELDS.find((candidate) => candidate === match[1]);
  if (!field) return null;
  const reason = match[2] ?? "";
  const copy = REASON_COPY[reason];
  return {
    field,
    message: copy ? copy(field) : `${shortLabel(field)} ${reason}`,
  };
}

export function bankAccountDetail(
  summary: SettlementBankAccountSummary,
): string {
  return summary.account_last4 === null
    ? summary.bank_name
    : `${summary.bank_name} · ending ${summary.account_last4}`;
}
