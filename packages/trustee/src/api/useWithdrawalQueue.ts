/**
 * React Query hook over `GET /v1/withdrawal-queue` for the Withdrawal Queue tab
 * (#945). Hand-mirrored backend shape (TD-42; no `@pipeline/frontend` dep).
 *
 * spec: docs/frontend/trustee-flows.md#cash-management--withdrawal-queue.
 */
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";

export interface WithdrawalQueueSummary {
  // `in_queue_usd` = the doc's `totalClaimable`; base-6 decimal string in human
  // units (format with `@/utils/formatUsd`, not `parseUnits`).
  in_queue_usd: string;
  requests_count: number;
  estimated_wait_days: string | null;
  liquid_cover: string | null;
}

export interface WithdrawalQueueItem {
  account: string;
  amount: string;
  status: "Queued" | "Completed" | (string & Record<never, never>);
}

export interface WithdrawalQueueResponse {
  summary: WithdrawalQueueSummary;
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
