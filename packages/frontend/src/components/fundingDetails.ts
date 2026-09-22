// spec: docs/frontend/bank-transfers.md#fundingdetails
export interface FundingDetailRow {
  label: string;
  value: string;
}

export const FUNDING_DETAIL_LABELS: ReadonlyArray<string> = [
  "Company Name",
  "Bank Name",
  "Bank Address",
  "Account Number",
  "IBAN",
  "SWIFT / BIC code",
];

export const FUNDING_DETAILS_PLACEHOLDER: ReadonlyArray<FundingDetailRow> = [
  { label: "Company Name", value: "Pipeline Trust LLC" },
  { label: "Bank Name", value: "HSBC Bank" },
  { label: "Bank Address", value: "London, 1st Canary Wharf" },
  { label: "Account Number", value: "1234567890" },
  { label: "IBAN", value: "GB29 UKBP 1234 5678 9012 34" },
  { label: "SWIFT / BIC code", value: "UKBPLD2LXXX" },
];

export function formatFundingDetailsForCopy(
  rows: ReadonlyArray<FundingDetailRow>,
): string {
  return rows.map((row) => `${row.label}: ${row.value}`).join("\n");
}
