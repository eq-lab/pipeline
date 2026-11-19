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
import { loanActionChainReason } from "@/lib/targetChains";

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
        const blocked = loanActionChainReason(chainId);
        if (blocked) throw new Error(blocked);
        if (!ENV.EVM_LOAN_REGISTRY_ADDRESS || !ENV.EVM_ACCESS_MANAGER_ADDRESS) {
          throw new Error(
            "On-chain rollover is not configured for this environment.",
          );
        }
        if (!wallet.isConnected || !wallet.address) {
          throw new Error("EVM wallet not connected.");
        }
        return rolloverEvmLoan({
          accessManager: ENV.EVM_ACCESS_MANAGER_ADDRESS,
          registry: ENV.EVM_LOAN_REGISTRY_ADDRESS,
          caller: wallet.address,
          chainId: ENV.EVM_CHAIN_ID,
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
