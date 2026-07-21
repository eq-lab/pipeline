/**
 * Per-loan CCR time series for the loan-detail CCR-trend chart (issue #879):
 * `GET /v1/loan-book/{loan_id}/ccr-history`. Replaces the mock `WATCHLIST_CCR_TREND`
 * fixed-geometry chart (#859) with the real price-derived series.
 *
 * Mirrors `useLoanFinancials` / `useLoanValuation`: Stellar-scoped (`chain_id`
 * from ENV), `apiFetch` REST call, hand-mirrored DTO (TD-42). The `from`
 * timestamp (Unix **seconds**) is required by the endpoint; the caller passes
 * the loan's start window and the query stays disabled until it's known.
 */
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/api/client";
import { ENV } from "@/lib/env";

/** One CCR grid point. `ccr_bps` is basis points (`12_000` = 120%). */
export interface CcrHistoryPoint {
  /** ISO-8601 UTC timestamp of the grid point. */
  timestamp: string;
  ccr_bps: number;
}

export interface CcrHistoryResponse {
  loan_id: string;
  chain_id: number;
  /** Series start / end, ISO-8601 UTC. */
  from: string;
  to: string;
  step_seconds: number;
  /** Samples, oldest → newest; leading points before the first stored price are omitted. */
  points: CcrHistoryPoint[];
}

export interface UseLoanCcrHistoryResult {
  data: CcrHistoryResponse | undefined;
  isLoading: boolean;
  error: Error | null;
}

/**
 * @param loanId  on-chain loan id
 * @param from    series start, Unix epoch **seconds** (required by the endpoint);
 *                pass `null` to keep the query disabled until it's known
 * @param stepSeconds  sampling interval (default 86400 = 1 day)
 */
export function useLoanCcrHistory(
  loanId: string,
  from: number | null,
  stepSeconds = 86_400,
): UseLoanCcrHistoryResult {
  const chainId = ENV.STELLAR_CHAIN_ID;

  const query = useQuery<CcrHistoryResponse, Error>({
    queryKey: ["loan-ccr-history", chainId, loanId, from, stepSeconds],
    queryFn: () =>
      apiFetch<CcrHistoryResponse>(
        `/v1/loan-book/${encodeURIComponent(loanId)}/ccr-history` +
          `?from=${from}&step=${stepSeconds}&chain_id=${chainId}`,
      ),
    enabled: loanId.length > 0 && from != null && from > 0,
    refetchInterval: 30_000,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
  };
}
