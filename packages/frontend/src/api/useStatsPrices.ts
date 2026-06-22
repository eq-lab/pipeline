/**
 * React Query hook — fetches averaged sPLUSD share-price history from
 * `GET /v1/stats/prices`.
 */
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";

export type StatsPricesInterval = "hourly" | "daily" | "weekly";

export interface StatsPriceItem {
  /** ISO-8601 timestamp for the start of the bucket. */
  timestamp: string;
  /** Average share price for the period. */
  avg_price: string;
}

export interface StatsPricesResponse {
  vault_address: string;
  interval: StatsPricesInterval;
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

function periodToQuery(periodId: string): {
  days?: number;
  interval: StatsPricesInterval;
} {
  switch (periodId) {
    case "7d":
      return { days: 7, interval: "hourly" };
    case "1m":
      return { days: 30, interval: "daily" };
    case "3m":
      return { days: 90, interval: "daily" };
    case "1y":
      return { days: 365, interval: "daily" };
    case "all":
    default:
      return { interval: "weekly" };
  }
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
