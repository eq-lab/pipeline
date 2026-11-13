// spec: docs/frontend/hooks.md (useLoanBook); mock key in src/api/README.md
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LoanBookSummary {
  total_deployed: string;
  total_collateral: string | null;
  senior_debt_coverage: string | null;
  avg_yield: string | null;
  avg_duration_days: number | null;
}

export interface LoanBookEntry {
  chain_id: number;
  loan_id: string;
  originator: string;
  borrower: string;
  commodity: string;
  principal: string;
  duration_days: number;
  rate: string;
  protection: string | null;
  status: string;
  ltv_bps?: number | null;
}

export interface LoanBookResponse {
  summary: LoanBookSummary;
  loans: LoanBookEntry[];
}

export interface UseLoanBookResult {
  data: LoanBookResponse | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useLoanBook({
  chainId,
}: {
  chainId: number;
}): UseLoanBookResult {
  const query = useQuery<LoanBookResponse, Error>({
    queryKey: ["loan-book", chainId],
    queryFn: () =>
      apiFetch<LoanBookResponse>(`/v1/loan-book?chain_id=${chainId}`),
    refetchInterval: 30_000,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}
