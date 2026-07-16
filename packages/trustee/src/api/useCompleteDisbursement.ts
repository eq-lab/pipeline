/**
 * React Query mutation hook — marks a loan's USDC off-ramp complete via
 * `POST /v1/loan-book/{loan_id}/disbursement/complete` (issue #862), flipping it
 * out of the derived `Disbursing` display status so the API surfaces its live
 * on-chain status.
 *
 * Contract source of truth: `packages/api/src/routes/loan_book.rs`,
 * `complete_disbursement`:
 *   - **Trustee-only** — `apiFetch` injects `Authorization: Bearer <token>`
 *     (#791); `403` when the caller lacks the `trustee` role, `401` on a
 *     missing/invalid/expired token.
 *   - **Idempotent** — completing an already-complete loan just refreshes the
 *     actor/timestamp; `200` with an empty body either way.
 *   - **`404`** when no loan with that id is indexed on the chain (surfaced as a
 *     typed `ApiError` with `.status === 404`).
 *   - Stellar-scoped `chain_id`, matching the read hooks.
 *
 * On success, invalidates the loan-book / financials / valuation queries (React
 * Query matches by key prefix) so the loan detail + list refetch and the status
 * flips out of `Disbursing`.
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
