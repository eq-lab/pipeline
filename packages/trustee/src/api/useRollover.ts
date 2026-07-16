/**
 * React Query mutation hook — wraps `@pipeline/wallet-connect`'s `rollover`
 * (issue #870): the trustee-wallet-signed on-chain `LoanRegistry.rollover` run
 * through the executor `execute` proxy (same pattern as `useDrawLoan`/#831).
 *
 * Rollover appends an epoch from the prior maturity, sets `currentMaturityDate`,
 * returns the loan's status to Performing, and raises the mint ceiling only
 * (mints nothing). On success this invalidates the loan-book / financials /
 * valuation queries so the loan detail + list refetch and the status flips
 * Matured → Performing.
 *
 * Like `useDrawLoan`, the Soroban machinery lives in the shared package (TD-33);
 * this hook only wires env + the connected wallet, guards the
 * unconfigured/disconnected cases, and surfaces the progress stage.
 */
import { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  rollover,
  useStellarWallet,
  type RolloverStage,
} from "@pipeline/wallet-connect";
import { ENV } from "@/lib/env";

export type { RolloverStage };

export interface UseRolloverInput {
  /** On-chain loan id (u32). */
  loanId: number;
  /** New senior interest rate, basis points. */
  newRateBps: number;
  /** New maturity timestamp, Unix seconds. */
  newMaturity: number;
}

export interface UseRolloverResult {
  mutate: (input: UseRolloverInput) => void;
  mutateAsync: (input: UseRolloverInput) => Promise<{ hash: string }>;
  isPending: boolean;
  isSuccess: boolean;
  error: Error | null;
  /** In-flight progress stage, or `null` before/after an attempt. */
  stage: RolloverStage | null;
  reset: () => void;
}

export function useRollover(): UseRolloverResult {
  const { address, isConnected, signTransaction } = useStellarWallet();
  const [stage, setStage] = useState<RolloverStage | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation<{ hash: string }, Error, UseRolloverInput>({
    mutationFn: async ({ loanId, newRateBps, newMaturity }) => {
      setStage(null);

      if (
        !ENV.STELLAR_LOAN_REGISTRY_ID ||
        !ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID
      ) {
        throw new Error(
          "On-chain rollover is not configured for this environment.",
        );
      }
      if (!isConnected || !address) {
        throw new Error("Stellar wallet not connected.");
      }

      return rollover({
        executorId: ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID,
        targetId: ENV.STELLAR_LOAN_REGISTRY_ID,
        caller: address,
        loanId,
        newRateBps,
        newMaturity,
        rpcUrl: ENV.STELLAR_RPC_URL,
        networkPassphrase: ENV.STELLAR_NETWORK_PASSPHRASE,
        signTransaction,
        onStageChange: setStage,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["loan-book"] });
      void queryClient.invalidateQueries({ queryKey: ["loan-financials"] });
      void queryClient.invalidateQueries({ queryKey: ["loan-valuation"] });
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
