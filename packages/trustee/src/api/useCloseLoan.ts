/**
 * React Query mutation hook — wraps `@pipeline/wallet-connect`'s `closeLoan`:
 * the trustee-wallet-signed on-chain `LoanRegistry.close_loan`, run through
 * the executor `execute` proxy (same pattern as `useRecordPayment`). Moves
 * the loan to `Closed` with a `ClosureReason`.
 *
 * On success, invalidates the loan-book/financials queries immediately and
 * again after short delays — the close is indexed asynchronously, so the
 * immediate refetch races the indexer and the next poll is 30 s out (#1092).
 *
 * spec: docs/frontend/trustee-flows.md#close-loan-gating-884-resolved-open-questions-13.
 */
import { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  closeLoan,
  useStellarWallet,
  type CloseLoanStage,
} from "@pipeline/wallet-connect";
import { ENV } from "@/lib/env";

export type { CloseLoanStage };

export interface UseCloseLoanInput {
  /** On-chain loan id (u32). */
  loanId: number;
  /** A `ClosureReason` variant — `ScheduledMaturity` | `EarlyRepayment` for a repayment close. */
  reason: string;
}

export interface UseCloseLoanResult {
  mutate: (input: UseCloseLoanInput) => void;
  mutateAsync: (input: UseCloseLoanInput) => Promise<{ hash: string }>;
  isPending: boolean;
  isSuccess: boolean;
  error: Error | null;
  stage: CloseLoanStage | null;
  reset: () => void;
}

export function useCloseLoan(): UseCloseLoanResult {
  const { address, isConnected, signTransaction } = useStellarWallet();
  const [stage, setStage] = useState<CloseLoanStage | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation<{ hash: string }, Error, UseCloseLoanInput>({
    mutationFn: async ({ loanId, reason }) => {
      setStage(null);

      if (
        !ENV.STELLAR_LOAN_REGISTRY_ID ||
        !ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID
      ) {
        throw new Error(
          "On-chain loan closing is not configured for this environment.",
        );
      }
      if (!isConnected || !address) {
        throw new Error("Stellar wallet not connected.");
      }

      return closeLoan({
        executorId: ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID,
        targetId: ENV.STELLAR_LOAN_REGISTRY_ID,
        caller: address,
        loanId,
        reason,
        rpcUrl: ENV.STELLAR_RPC_URL,
        networkPassphrase: ENV.STELLAR_NETWORK_PASSPHRASE,
        signTransaction,
        onStageChange: setStage,
      });
    },
    onSuccess: () => {
      const invalidate = () => {
        void queryClient.invalidateQueries({ queryKey: ["loan-book"] });
        void queryClient.invalidateQueries({ queryKey: ["loan-financials"] });
      };
      invalidate();
      for (const delayMs of [5_000, 15_000]) {
        setTimeout(invalidate, delayMs);
      }
    },
  });

  const reset = useCallback(() => {
    setStage(null);
    mutation.reset();
  }, [mutation]);

  return {
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    isSuccess: mutation.isSuccess,
    error: mutation.error,
    stage,
    reset,
  };
}
