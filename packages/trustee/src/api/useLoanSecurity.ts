// spec: docs/frontend/trustee-flows.md#security-card
import { useQuery } from "@tanstack/react-query";
import { ApiError, apiFetch } from "./client";
import { isStellarTarget } from "@/lib/targetChains";
import type { PendingOperation } from "./pendingOperations";

export interface LoanSecurityTerms {
  advance_ratio_bps?: number;
  margin_call_ratio_bps?: number;
  cure_period?: string;
  price_stale_after?: string;
  payment_term?: string;
  grace_period?: string;
  default_rate?: number;
  attestation_interval?: string;
  inspection_interval?: string;
  tolerance_bps?: number;
  grade_tolerance_bps?: number;
}

export interface LoanSecurityInspection {
  inspection_id?: string;
  inspector?: string;
  kind?: string;
  inspected_at?: string | null;
  entered_by?: string | null;
  entered_at?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  resolved_at?: string | null;
  is_lot_latest?: boolean;
  complete?: boolean;
  quantity?: string | null;
  grade?: string | null;
  variance_reference_bps?: number | null;
  variance_previous_bps?: number | null;
  variance_grade_bps?: number | null;
  flagged?: boolean | null;
  resolution?: string | null;
}

export interface LoanSecurityRecordMark {
  value_per_unit?: string | null;
  at?: string | null;
  benchmark?: string | null;
}

export interface LoanSecurityRecordValuation {
  counted_quantity?: string;
  value_per_unit?: string;
  mark_at?: string;
  value?: string;
  stale?: boolean;
  flagged?: boolean;
}

export interface LoanSecurityRecordLot {
  latest_inspection_id?: string | null;
  latest_inspected_at?: string | null;
  latest_quantity?: string | null;
}

export interface LoanSecurityRecord {
  record_id?: string;
  lot_id?: string;
  protection?: string;
  commodity?: string | null;
  unit?: string | null;
  status?: string;
  open?: boolean;
  flagged_by?: string | null;
  reference_quantity?: string | null;
  reference_grade?: string | null;
  perfected_at?: string | null;
  attested_by?: string | null;
  attested_at?: string | null;
  counts_toward_value?: boolean;
  attestation_stale?: boolean | null;
  inspection_stale?: boolean | null;
  mark_stale?: boolean | null;
  mark?: LoanSecurityRecordMark | null;
  valuation?: LoanSecurityRecordValuation | null;
  lot?: LoanSecurityRecordLot | null;
  release_reason_hash?: string | null;
  released_by_consent?: boolean | null;
  inspections?: LoanSecurityInspection[];
}

export interface LoanSecurityValuation {
  value?: string | null;
  debt?: string | null;
  ltv_bps?: number;
  price_stale?: boolean;
}

export interface LoanSecurityMarginCall {
  open?: boolean | null;
  opened_at?: string | null;
  cure_by?: string | null;
  cure_overdue?: boolean | null;
  open_call_curable?: boolean | null;
  ltv_above_ratio_no_onchain_call?: boolean | null;
}

export interface LoanSecurityPrices {
  price_stale?: boolean | null;
}

export interface LoanSecurityResponse {
  refresh_pending?: boolean;
  paused?: boolean;
  inspectors?: string[];
  records?: LoanSecurityRecord[];
  terms?: LoanSecurityTerms | null;
  valuation?: LoanSecurityValuation | null;
  margin_call?: LoanSecurityMarginCall | null;
  prices?: LoanSecurityPrices | null;
  pending_operations?: PendingOperation[];
}

export interface UseLoanSecurityResult {
  data: LoanSecurityResponse | undefined;
  isLoading: boolean;
  error: Error | null;
  notConfigured: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
}

export function isRegistryNotConfigured(error: Error | null): boolean {
  return (
    error instanceof ApiError &&
    error.status === 404 &&
    /security_registry_not_configured/.test(error.message)
  );
}

export function useLoanSecurity(
  chainId: number,
  loanId: string,
): UseLoanSecurityResult {
  const enabled = isStellarTarget(chainId) && /^\d+$/.test(loanId);
  const query = useQuery<LoanSecurityResponse, Error>({
    queryKey: ["loan-security", chainId, loanId],
    queryFn: () =>
      apiFetch<LoanSecurityResponse>(
        `/v1/loan-book/${encodeURIComponent(loanId)}/security?chain_id=${chainId}`,
      ),
    enabled,
    refetchInterval: (q) =>
      isRegistryNotConfigured(q.state.error) ? false : 30_000,
    retry: false,
  });

  const notConfigured = !enabled || isRegistryNotConfigured(query.error);

  return {
    data: enabled ? query.data : undefined,
    isLoading: enabled && query.isLoading,
    error: enabled ? query.error : null,
    notConfigured,
    dataUpdatedAt: enabled ? query.dataUpdatedAt : 0,
    refetch: () => void query.refetch(),
  };
}
