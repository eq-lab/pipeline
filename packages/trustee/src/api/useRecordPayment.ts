/**
 * React Query mutation hook — wraps `@pipeline/wallet-connect`'s `recordPayment`
 * (issue #882): the trustee-wallet-signed on-chain `LoanRegistry.record_payment`
 * run through the executor `execute` proxy (same pattern as `useUpdateLifecycle`).
 *
 * Pure accounting — records a repayment split (senior principal / interest, fees,
 * equity); moves no USDC and mints no PLUSD. On success this invalidates the
 * loan-book / financials / waterfall queries so the detail + preview refetch.
 *
 * Like `useUpdateLifecycle`/`useDrawLoan`, the Soroban machinery lives in the
 * shared package (TD-33); this hook only wires env + the connected wallet, guards
 * the unconfigured/disconnected cases, and surfaces the progress stage.
 */
import { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  recordPayment,
  useStellarWallet,
  type RecordPaymentStage,
  type RepaymentInput,
} from "@pipeline/wallet-connect";
import { ENV } from "@/lib/env";

export type { RecordPaymentStage, RepaymentInput };

export interface UseRecordPaymentInput {
  /** On-chain loan id (u32). */
  loanId: number;
  /** The `RepaymentData` split — base-unit (7-decimal USDC) integer strings. */
  repayment: RepaymentInput;
}

export interface UseRecordPaymentResult {
  mutate: (input: UseRecordPaymentInput) => void;
  mutateAsync: (input: UseRecordPaymentInput) => Promise<{ hash: string }>;
  isPending: boolean;
  isSuccess: boolean;
  error: Error | null;
  stage: RecordPaymentStage | null;
  reset: () => void;
}

export function useRecordPayment(): UseRecordPaymentResult {
  const { address, isConnected, signTransaction } = useStellarWallet();
  const [stage, setStage] = useState<RecordPaymentStage | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation<{ hash: string }, Error, UseRecordPaymentInput>({
    mutationFn: async ({ loanId, repayment }) => {
      setStage(null);

      if (
        !ENV.STELLAR_LOAN_REGISTRY_ID ||
        !ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID
      ) {
        throw new Error(
          "On-chain payment recording is not configured for this environment.",
        );
      }
      if (!isConnected || !address) {
        throw new Error("Stellar wallet not connected.");
      }

      return recordPayment({
        executorId: ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID,
        targetId: ENV.STELLAR_LOAN_REGISTRY_ID,
        caller: address,
        loanId,
        repayment,
        rpcUrl: ENV.STELLAR_RPC_URL,
        networkPassphrase: ENV.STELLAR_NETWORK_PASSPHRASE,
        signTransaction,
        onStageChange: setStage,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["loan-book"] });
      void queryClient.invalidateQueries({ queryKey: ["loan-financials"] });
      void queryClient.invalidateQueries({ queryKey: ["loan-waterfall"] });
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
