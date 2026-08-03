/**
 * React Query hook over `GET /v1/withdrawal-queue` for the Cash Management
 * **Withdrawal Queue** tab (issue #945). A self-contained hand-mirror of the
 * backend shape — TD-42 convention, the trustee app does not depend on
 * `@pipeline/frontend` (whose `useWithdrawalQueue` reads the same endpoint).
 *
 * `in_queue_usd` and `amount` are base-6 decimal strings already in human units
 * (e.g. `"1200000.000000"` = $1.2M) — format with `@/utils/formatUsd`, not
 * `parseUnits`. This endpoint carries the queue total (`in_queue_usd` = the
 * doc's `totalClaimable`) and request count, but NOT the WithdrawalQueue
 * wallet's on-chain USDC balance.
 */
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";

export interface WithdrawalQueueSummary {
  /** Total amount in queue (the doc's `totalClaimable`), USDC base-6 decimal string. */
  in_queue_usd: string;
  /** Number of withdrawal requests. */
  requests_count: number;
  /** Estimated wait in days — 1-decimal string, or `null`. */
  estimated_wait_days: string | null;
  /** Liquid cover ratio — 2-decimal string, or `null` (currently always null). */
  liquid_cover: string | null;
}

export interface WithdrawalQueueItem {
  /** Withdrawer wallet address (EVM or Stellar). */
  account: string;
  /** Withdrawal amount, USDC base-6 decimal string. */
  amount: string;
  status: "Queued" | "Completed" | (string & Record<never, never>);
}

export interface WithdrawalQueueResponse {
  summary: WithdrawalQueueSummary;
  /** Withdrawal requests, newest-first. */
  items: WithdrawalQueueItem[];
}

export interface UseWithdrawalQueueResult {
  data: WithdrawalQueueResponse | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useWithdrawalQueue(): UseWithdrawalQueueResult {
  const query = useQuery<WithdrawalQueueResponse, Error>({
    queryKey: ["withdrawal-queue"],
    queryFn: () => apiFetch<WithdrawalQueueResponse>("/v1/withdrawal-queue"),
    refetchInterval: 30_000,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}
