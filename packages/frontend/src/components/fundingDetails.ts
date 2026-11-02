// spec: docs/frontend/bank-transfers.md#fundingdetails
import { ApiError, chainDisplayName } from "@/api";
import type { PaymentDetailsResponse } from "@/api";

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

export const PAYMENT_REFERENCE_LABEL = "Payment reference";

export type FundingDetailsView =
  | { status: "loading" }
  | {
      status: "ready";
      rows: FundingDetailRow[];
      paymentReference: string;
      network: string;
      receiverAddress: string;
    }
  | {
      status: "unavailable";
      reason: "not-linked" | "error";
      chainName: string;
    };

export function displayValue(v: string | null | undefined): string {
  return v === null || v === undefined || v === "" ? "—" : v;
}

export function toFundingDetailsView(
  response: PaymentDetailsResponse,
  kind: "evm" | "stellar",
): Extract<FundingDetailsView, { status: "ready" }> {
  const values = [
    response.company_name,
    response.bank_name,
    response.bank_address,
    response.account_number,
    response.iban,
    response.swift_bic_code,
    response.payment_details,
  ];
  const labels = [...FUNDING_DETAIL_LABELS, PAYMENT_REFERENCE_LABEL];
  const rows = labels.map((label, i) => ({
    label,
    value: displayValue(values[i]),
  }));
  return {
    status: "ready",
    rows,
    paymentReference: displayValue(response.payment_details),
    network: chainDisplayName(kind, response.chain_id),
    receiverAddress: displayValue(response.receiver_address),
  };
}

export function toUnavailableView(
  error: unknown,
  chainName: string,
): Extract<FundingDetailsView, { status: "unavailable" }> {
  const notLinked = error instanceof ApiError && error.status === 409;
  return {
    status: "unavailable",
    reason: notLinked ? "not-linked" : "error",
    chainName,
  };
}

export function formatFundingDetailsForCopy(
  rows: ReadonlyArray<FundingDetailRow>,
): string {
  return rows.map((row) => `${row.label}: ${row.value}`).join("\n");
}
