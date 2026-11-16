// spec: docs/frontend/trustee-flows.md#settlement-bank-account
import type { CashBookWireOut } from "@/api/useCashBook";
import type { SettlementBankAccountDetails } from "@/api/useLp";

export type BankAccountField = keyof SettlementBankAccountDetails;

export const BANK_ACCOUNT_FIELDS: readonly BankAccountField[] = [
  "account_holder_name",
  "bank_name",
  "bank_address",
  "iban",
  "account_number",
  "swift_bic_code",
  "routing_number",
];

export const BANK_ACCOUNT_LABELS: Record<BankAccountField, string> = {
  account_holder_name: "Account holder name",
  bank_name: "Bank name",
  bank_address: "Bank address",
  iban: "IBAN",
  account_number: "Account number",
  swift_bic_code: "SWIFT/BIC code",
  routing_number: "Routing number (ABA)",
};

export const COPYABLE_BANK_FIELDS: readonly BankAccountField[] = [
  "iban",
  "account_number",
  "swift_bic_code",
  "routing_number",
];

export interface BankAccountRowData {
  field: BankAccountField;
  label: string;
  value: string | null;
  copyable: boolean;
}

export function bankAccountRows(
  details: SettlementBankAccountDetails,
): BankAccountRowData[] {
  return BANK_ACCOUNT_FIELDS.map((field) => {
    const value = details[field] ?? null;
    return {
      field,
      label: BANK_ACCOUNT_LABELS[field],
      value,
      copyable: value !== null && COPYABLE_BANK_FIELDS.includes(field),
    };
  });
}

export type WireOutBankAccountState =
  | "served"
  | "missing"
  | "unresolved"
  | "not-pending";

export function wireOutBankAccountState(
  wire: Pick<CashBookWireOut, "status" | "lp_id" | "bank_account">,
): WireOutBankAccountState {
  if (wire.status !== "Pending") return "not-pending";
  if (wire.lp_id === undefined || wire.lp_id === null) return "unresolved";
  return wire.bank_account ? "served" : "missing";
}
