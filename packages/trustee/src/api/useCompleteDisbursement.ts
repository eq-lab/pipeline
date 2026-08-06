/**
 * React Query mutation hook — marks a loan's USDC off-ramp complete via
 * `POST /v1/loan-book/{loan_id}/disbursement/complete`, flipping it out of
 * the derived `Disbursing` display status. Trustee-only (`403`/`401` per
 * `apiFetch`'s auth injection); idempotent — completing an already-complete
 * loan just refreshes the actor/timestamp; `404` when no loan with that id
 * is indexed.
 *
 * spec: docs/frontend/trustee-flows.md#wired-actions (Disbursement complete).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { ENV } from "@/lib/env";

export interface CompleteDisbursementInput {
  loanId: string;
}

export function useCompleteDisbursement() {
  const queryClient = useQueryClient();
  const chainId = ENV.STELLAR_CHAIN_ID;

  return useMutation<void, Error, CompleteDisbursementInput>({
    mutationFn: async ({ loanId }) => {
      await apiFetch<unknown>(
        `/v1/loan-book/${encodeURIComponent(loanId)}/disbursement/complete?chain_id=${chainId}`,
        { method: "POST" },
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["loan-book"] });
      void queryClient.invalidateQueries({ queryKey: ["loan-financials"] });
      void queryClient.invalidateQueries({ queryKey: ["loan-valuation"] });
    },
  });
}
