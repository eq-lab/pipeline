/**
 * React Query hook — fetches averaged sPLUSD share-price history from
 * `GET /v1/stats/prices`.
 *
 * The period → API query mapping is shared with `useStatsYield` via the
 * `periodToQuery` util from `@/utils/statsPeriod`.
 */
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { periodToQuery } from "@/utils/statsPeriod";

// Re-export the interval type so callers that imported it from here continue
// to compile without changes.
export type { StatsPricesInterval } from "@/utils/statsPeriod";

export interface StatsPriceItem {
  /** ISO-8601 timestamp for the start of the bucket. */
  timestamp: string;
  /** Average share price for the period. */
  avg_price: string;
}

export interface StatsPricesResponse {
  vault_address: string;
  interval: import("@/utils/statsPeriod").StatsPricesInterval;
  prices: StatsPriceItem[];
}

export interface UseStatsPricesParams {
  vaultAddress: string;
  chainId: number;
  periodId: string;
  enabled?: boolean;
}

export interface UseStatsPricesResult {
  data: StatsPricesResponse | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useStatsPrices({
  vaultAddress,
  chainId,
  periodId,
  enabled = true,
}: UseStatsPricesParams): UseStatsPricesResult {
  const query = useQuery<StatsPricesResponse, Error>({
    queryKey: ["stats-prices", vaultAddress, chainId, periodId],
    queryFn: () => {
      const period = periodToQuery(periodId);
      const params = new URLSearchParams({
        vault: vaultAddress,
        chain_id: String(chainId),
        interval: period.interval,
      });
      if (period.days !== undefined) {
        params.set("days", String(period.days));
      }
      return apiFetch<StatsPricesResponse>(
        `/v1/stats/prices?${params.toString()}`,
      );
    },
    enabled: enabled && vaultAddress.length > 0,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}
