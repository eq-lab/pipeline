// spec: docs/frontend/trustee-flows.md#security-card
import { useQuery } from "@tanstack/react-query";
import { ApiError, apiFetch } from "./client";
import { isStellarTarget } from "@/lib/targetChains";

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
  quantity?: string | null;
  grade?: string | null;
  variance_reference_bps?: number | null;
  variance_previous_bps?: number | null;
  variance_grade_bps?: number | null;
  flagged?: boolean | null;
  resolution?: string | null;
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
}

export interface UseLoanSecurityResult {
  data: LoanSecurityResponse | undefined;
  isLoading: boolean;
  error: Error | null;
  notConfigured: boolean;
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
    refetch: () => void query.refetch(),
  };
}
