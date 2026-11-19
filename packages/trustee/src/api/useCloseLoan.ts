// spec: docs/frontend/trustee-flows.md#close-loan-gating-884-resolved-open-questions-13
import { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  closeEvmLoan,
  closeLoan,
  useEvmWallet,
  useStellarWallet,
  type CloseLoanStage,
} from "@pipeline/wallet-connect";
import { ENV } from "@/lib/env";
import { pickChainWallet } from "@/lib/chainWallet";
import { evmLoanRegistryConfig, evmPreflight } from "@/lib/evmPreflight";

export type { CloseLoanStage };

export interface UseCloseLoanInput {
  loanId: number;
  reason: string;
  chainId: number | null | undefined;
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
  const stellar = useStellarWallet();
  const evm = useEvmWallet();
  const [stage, setStage] = useState<CloseLoanStage | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation<{ hash: string }, Error, UseCloseLoanInput>({
    mutationFn: async ({ loanId, reason, chainId }) => {
      setStage(null);
      const wallet = pickChainWallet(chainId, stellar, evm);

      if (wallet.kind === "evm") {
        const {
          config,
          caller,
          chainId: evmChainId,
        } = evmPreflight({
          chainId,
          wallet,
          config: evmLoanRegistryConfig(),
          notConfigured:
            "On-chain loan closing is not configured for this environment.",
        });
        return closeEvmLoan({
          accessManager: config.accessManager,
          registry: config.registry,
          caller,
          chainId: evmChainId,
          loanId,
          reason,
          onStageChange: setStage,
        });
      }

      if (
        !ENV.STELLAR_LOAN_REGISTRY_ID ||
        !ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID
      ) {
        throw new Error(
          "On-chain loan closing is not configured for this environment.",
        );
      }
      if (!stellar.isConnected || !stellar.address) {
        throw new Error("Stellar wallet not connected.");
      }

      return closeLoan({
        executorId: ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID,
        targetId: ENV.STELLAR_LOAN_REGISTRY_ID,
        caller: stellar.address,
        loanId,
        reason,
        rpcUrl: ENV.STELLAR_RPC_URL,
        networkPassphrase: ENV.STELLAR_NETWORK_PASSPHRASE,
        signTransaction: stellar.signTransaction,
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
