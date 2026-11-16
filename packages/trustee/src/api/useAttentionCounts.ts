// spec: docs/product-specs/trustee-attention-counts.md#api-contract
import { useQuery } from "@tanstack/react-query";
import { apiFetch, ApiError } from "./client";

export interface OriginationCounts {
  count: number;
  in_review: number;
  changes_requested: number;
  approved_undrawn: number;
}

export interface LoanCounts {
  count: number;
  watch_list: number;
  past_due: number;
  margin_call_open: number | null;
  disbursing: number;
  defaulted: number;
}

export interface CashManagementCounts {
  count: number;
  escrowed_wire_ins: number | null;
  pending_wire_outs: number | null;
  open_ramps: number | null;
  pending_ramp_events: number | null;
  pending_bank_deposits: number;
}

export interface ChainAttentionCounts {
  chain_id: number;
  origination: OriginationCounts;
  loans: LoanCounts;
  cash_management: CashManagementCounts;
}

export interface AttentionCountsResponse {
  origination: OriginationCounts;
  loans: LoanCounts;
  cash_management: CashManagementCounts;
  chains: ChainAttentionCounts[];
}

export const attentionCountsKey = ["attention-counts"] as const;

export function useAttentionCounts() {
  return useQuery<AttentionCountsResponse, Error>({
    queryKey: attentionCountsKey,
    queryFn: () => apiFetch<AttentionCountsResponse>("/v1/attention-counts"),
    refetchInterval: 30_000,
    retry: (count, error) =>
      !(
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500
      ) && count < 2,
  });
}
