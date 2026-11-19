// spec: docs/frontend/trustee-flows.md#cash-movement--lifecycle-actions
import { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  evmRepaymentRefHash,
  readEvmNextRepaymentId,
  readNextRepaymentId,
  repay,
  repayEvmLoan,
  repaymentRefHash,
  useEvmWallet,
  useStellarWallet,
  type RepayStage,
  type RepaymentInput,
} from "@pipeline/wallet-connect";
import { ENV } from "@/lib/env";
import { pickChainWallet } from "@/lib/chainWallet";
import { loanActionChainReason } from "@/lib/targetChains";

export type { RepayStage, RepaymentInput };

export interface UseRecordPaymentInput {
  loanId: number;
  repayment: RepaymentInput;
  valueDate: number;
  chainId: number | null | undefined;
}

export interface RecordPaymentOutcome {
  hash: string;
  repaymentId?: number | null;
}

export interface UseRecordPaymentResult {
  mutate: (input: UseRecordPaymentInput) => void;
  mutateAsync: (input: UseRecordPaymentInput) => Promise<RecordPaymentOutcome>;
  isPending: boolean;
  isSuccess: boolean;
  error: Error | null;
  stage: RepayStage | null;
  reset: () => void;
}

export function useRecordPayment(): UseRecordPaymentResult {
  const stellar = useStellarWallet();
  const evm = useEvmWallet();
  const [stage, setStage] = useState<RepayStage | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation<
    RecordPaymentOutcome,
    Error,
    UseRecordPaymentInput
  >({
    mutationFn: async ({ loanId, repayment, valueDate, chainId }) => {
      setStage(null);
      const wallet = pickChainWallet(chainId, stellar, evm);

      if (wallet.kind === "evm") {
        const blocked = loanActionChainReason(chainId);
        if (blocked) throw new Error(blocked);
        if (!ENV.EVM_MINTER_ADDRESS || !ENV.EVM_LOAN_REGISTRY_ADDRESS) {
          throw new Error(
            "On-chain payment recording is not configured for this environment.",
          );
        }
        if (!wallet.isConnected || !wallet.address) {
          throw new Error("EVM wallet not connected.");
        }
        const nextRepaymentId = await readEvmNextRepaymentId({
          registry: ENV.EVM_LOAN_REGISTRY_ADDRESS,
          loanId,
        });
        const refHash = await evmRepaymentRefHash({
          registry: ENV.EVM_LOAN_REGISTRY_ADDRESS,
          loanId,
          nextRepaymentId,
        });
        return repayEvmLoan({
          minter: ENV.EVM_MINTER_ADDRESS,
          caller: wallet.address,
          chainId: ENV.EVM_CHAIN_ID,
          loanId,
          repayment,
          valueDate,
          refHash,
          saleId: 0,
          onStageChange: setStage,
        });
      }

      if (!ENV.STELLAR_YIELD_MINTER_ID || !ENV.STELLAR_LOAN_REGISTRY_ID) {
        throw new Error(
          "On-chain payment recording is not configured for this environment.",
        );
      }
      if (!stellar.isConnected || !stellar.address) {
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
        caller: stellar.address,
        loanId,
        repayment,
        valueDate,
        refHash,
        saleId: 0,
        rpcUrl,
        networkPassphrase,
        signTransaction: stellar.signTransaction,
        onStageChange: setStage,
      });
    },
    onSuccess: () => {
      const invalidate = () => {
        void queryClient.invalidateQueries({ queryKey: ["loan-book"] });
        void queryClient.invalidateQueries({ queryKey: ["loan-financials"] });
        void queryClient.invalidateQueries({ queryKey: ["loan-security"] });
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
