// spec: docs/frontend/trustee-flows.md#cash-movement--lifecycle-actions
import { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  repay,
  readNextRepaymentId,
  repaymentRefHash,
  useStellarWallet,
  type RepayStage,
  type RepaymentInput,
} from "@pipeline/wallet-connect";
import { ENV } from "@/lib/env";

export type { RepayStage, RepaymentInput };

export interface UseRecordPaymentInput {
  loanId: number;
  repayment: RepaymentInput;
  valueDate: number;
}

export interface UseRecordPaymentResult {
  mutate: (input: UseRecordPaymentInput) => void;
  mutateAsync: (input: UseRecordPaymentInput) => Promise<{ hash: string }>;
  isPending: boolean;
  isSuccess: boolean;
  error: Error | null;
  stage: RepayStage | null;
  reset: () => void;
}

export function useRecordPayment(): UseRecordPaymentResult {
  const { address, isConnected, signTransaction } = useStellarWallet();
  const [stage, setStage] = useState<RepayStage | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation<{ hash: string }, Error, UseRecordPaymentInput>({
    mutationFn: async ({ loanId, repayment, valueDate }) => {
      setStage(null);

      if (!ENV.STELLAR_YIELD_MINTER_ID || !ENV.STELLAR_LOAN_REGISTRY_ID) {
        throw new Error(
          "On-chain payment recording is not configured for this environment.",
        );
      }
      if (!isConnected || !address) {
        throw new Error("Stellar wallet not connected.");
      }

      const rpcUrl = ENV.STELLAR_RPC_URL;
      const networkPassphrase = ENV.STELLAR_NETWORK_PASSPHRASE;
      const nextRepaymentId = await readNextRepaymentId({
        registryId: ENV.STELLAR_LOAN_REGISTRY_ID,
        loanId,
        rpcUrl,
        networkPassphrase,
      });
      const refHash = await repaymentRefHash({
        registryId: ENV.STELLAR_LOAN_REGISTRY_ID,
        loanId,
        nextRepaymentId,
      });

      return repay({
        minterId: ENV.STELLAR_YIELD_MINTER_ID,
        caller: address,
        loanId,
        repayment,
        valueDate,
        refHash,
        saleId: 0,
        rpcUrl,
        networkPassphrase,
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
      void queryClient.invalidateQueries({ queryKey: ["loan-waterfall"] });
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
