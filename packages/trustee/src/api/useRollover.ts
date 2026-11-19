// spec: docs/frontend/trustee-flows.md#wired-actions
import { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  rollover,
  rolloverEvmLoan,
  useEvmWallet,
  useStellarWallet,
  type RolloverStage,
} from "@pipeline/wallet-connect";
import { ENV } from "@/lib/env";
import { pickChainWallet } from "@/lib/chainWallet";
import { evmLoanRegistryConfig, evmPreflight } from "@/lib/evmPreflight";

export type { RolloverStage };

export interface UseRolloverInput {
  loanId: number;
  newRateBps: number;
  newMaturity: number;
  chainId: number | null | undefined;
}

export interface UseRolloverResult {
  mutate: (input: UseRolloverInput) => void;
  mutateAsync: (input: UseRolloverInput) => Promise<{ hash: string }>;
  isPending: boolean;
  isSuccess: boolean;
  error: Error | null;
  stage: RolloverStage | null;
  reset: () => void;
}

export function useRollover(): UseRolloverResult {
  const stellar = useStellarWallet();
  const evm = useEvmWallet();
  const [stage, setStage] = useState<RolloverStage | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation<{ hash: string }, Error, UseRolloverInput>({
    mutationFn: async ({ loanId, newRateBps, newMaturity, chainId }) => {
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
            "On-chain rollover is not configured for this environment.",
        });
        return rolloverEvmLoan({
          accessManager: config.accessManager,
          registry: config.registry,
          caller,
          chainId: evmChainId,
          loanId,
          newRateBps,
          newMaturity,
          onStageChange: setStage,
        });
      }

      if (
        !ENV.STELLAR_LOAN_REGISTRY_ID ||
        !ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID
      ) {
        throw new Error(
          "On-chain rollover is not configured for this environment.",
        );
      }
      if (!stellar.isConnected || !stellar.address) {
        throw new Error("Stellar wallet not connected.");
      }

      return rollover({
        executorId: ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID,
        targetId: ENV.STELLAR_LOAN_REGISTRY_ID,
        caller: stellar.address,
        loanId,
        newRateBps,
        newMaturity,
        rpcUrl: ENV.STELLAR_RPC_URL,
        networkPassphrase: ENV.STELLAR_NETWORK_PASSPHRASE,
        signTransaction: stellar.signTransaction,
        onStageChange: setStage,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["loan-book"] });
      void queryClient.invalidateQueries({ queryKey: ["loan-financials"] });
      void queryClient.invalidateQueries({ queryKey: ["loan-security"] });
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
