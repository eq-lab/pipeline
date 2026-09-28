// spec: docs/frontend/trustee-flows.md#lp-counterparties.
import { useLps, type LpSummary } from "@/api/useLps";
import { formatIsoDateUtc } from "@/utils/formatDate";
import { ApiError } from "@/api/client";
import { toUserError } from "@/utils/userError";

export type AccountStatusBand =
  | "neutral"
  | "attention"
  | "positive"
  | "negative";

export interface AccountStatusChip {
  label: string;
  band: AccountStatusBand;
}

export interface LpCounterpartyRow {
  key: string;
  lpId: string;
  legalName: string;
  jurisdiction: string;
  registeredOn: string;
  status: AccountStatusChip;
  blockchainAddress: "Yes" | "No";
  bankInfo: string;
}

export type LpCounterpartiesState = "loading" | "error" | "empty" | "ready";

export interface UseLpCounterpartiesTableResult {
  state: LpCounterpartiesState;
  errorMessage: string | null;
  errorDetails: string | null;
  rows: LpCounterpartyRow[];
}

function safeString(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : "—";
}

export function mapKybStatus(kybStatus: string): AccountStatusChip {
  switch (kybStatus) {
    case "NotStarted":
      return { label: "New", band: "neutral" };
    case "InProgress":
      return { label: "KYB Pending", band: "attention" };
    case "UnderReview":
      return { label: "KYB Pending", band: "attention" };
    case "Passed":
      return { label: "Approved", band: "positive" };
    case "Failed":
      return { label: "Rejected", band: "negative" };
    default:
      return { label: safeString(kybStatus), band: "neutral" };
  }
}

export function mapLpToRow(lp: LpSummary): LpCounterpartyRow {
  return {
    key: String(lp.id),
    lpId: String(lp.id),
    legalName: safeString(lp.legal_name),
    jurisdiction: safeString(lp.country),
    registeredOn: formatIsoDateUtc(lp.created_at),
    status: mapKybStatus(lp.kyb_status),
    blockchainAddress:
      typeof lp.stellar_address === "string" && lp.stellar_address.length > 0
        ? "Yes"
        : "No",
    bankInfo: "—",
  };
}

export function useLpCounterpartiesTable(): UseLpCounterpartiesTableResult {
  const { data, isLoading, error } = useLps();

  if (isLoading) {
    return {
      state: "loading",
      errorMessage: null,
      errorDetails: null,
      rows: [],
    };
  }
  if (error) {
    if (error instanceof ApiError && error.status === 403) {
      return {
        state: "error",
        errorMessage:
          "Your trustee account is not authorized to view LP counterparties.",
        errorDetails: error.message,
        rows: [],
      };
    }
    const mapped = toUserError(error, "Failed to load LP counterparties.");
    return {
      state: "error",
      errorMessage: mapped.message,
      errorDetails: mapped.details,
      rows: [],
    };
  }
  const lps = data?.lps ?? [];
  if (lps.length === 0) {
    return { state: "empty", errorMessage: null, errorDetails: null, rows: [] };
  }
  return {
    state: "ready",
    errorMessage: null,
    errorDetails: null,
    rows: lps.map(mapLpToRow),
  };
}
