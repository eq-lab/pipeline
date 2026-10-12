// spec: docs/frontend/trustee-flows.md#lp-bank-deposits
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "./client";
import { lpFetch } from "./useLp";

/** Hand-mirror of `packages/api/src/routes/lp_bank_deposits.rs` (TD-42). */
export interface LpBankDeposit {
  id: number;
  lp_id: number;
  /** Plain dollar decimal string, e.g. `"50000.00"`. */
  amount: string;
  payment_reference: string;
  /** `sha256(payment_reference)`, lowercase hex. */
  ref_hash: string;
  /** ISO-8601 UTC. */
  occurred_at: string;
  is_minted: boolean;
  recorded_by: string;
  created_at: string;
}

export interface LpBankDepositsResponse {
  deposits: LpBankDeposit[];
}

export interface RecordBankDepositInput {
  lpId: number;
  amount: string;
  payment_reference: string;
  occurred_at: string;
}

export const lpBankDepositsKey = (id: number) => ["lp", id, "bank-deposits"];

export const LP_BANK_DEPOSITS_REFETCH_MS = 30_000;

export function useLpBankDeposits(
  id: number,
  refetchIntervalMs: number = LP_BANK_DEPOSITS_REFETCH_MS,
) {
  return useQuery<LpBankDepositsResponse, Error>({
    queryKey: lpBankDepositsKey(id),
    queryFn: ({ signal }) =>
      lpFetch<LpBankDepositsResponse>(`/v1/lps/${id}/bank-deposits`, {
        signal,
      }),
    enabled: Number.isSafeInteger(id) && id > 0,
    refetchInterval: refetchIntervalMs,
    retry: (count, error) =>
      !(error instanceof ApiError && [401, 403, 404].includes(error.status)) &&
      count < 2,
  });
}

export function useRecordBankDeposit() {
  const client = useQueryClient();
  return useMutation<LpBankDeposit, Error, RecordBankDepositInput>({
    mutationFn: ({ lpId, ...body }) =>
      lpFetch<LpBankDeposit>(`/v1/lps/${lpId}/bank-deposits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSettled: (_, __, input) =>
      client.invalidateQueries({ queryKey: lpBankDepositsKey(input.lpId) }),
  });
}
