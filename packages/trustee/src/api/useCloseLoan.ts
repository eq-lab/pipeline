/**
 * React Query mutation hook — wraps `@pipeline/wallet-connect`'s `closeLoan`
 * (issue #884): the trustee-wallet-signed on-chain `LoanRegistry.close_loan` run
 * through the executor `execute` proxy (same pattern as `useRecordPayment`).
 *
 * Moves the loan to `Closed` with a `ClosureReason` (the trustee repayment-close
 * reasons: `ScheduledMaturity` when at/after maturity, `EarlyRepayment` before).
 * On success this invalidates the loan-book / financials queries so the detail
 * refetches the closed status.
 *
 * Like the other on-chain hooks (TD-33), the Soroban machinery lives in the
 * shared package; this hook only wires env + the connected wallet, guards the
 * unconfigured/disconnected cases, and surfaces the progress stage.
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
      void queryClient.invalidateQueries({ queryKey: ["loan-book"] });
      void queryClient.invalidateQueries({ queryKey: ["loan-financials"] });
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
