// spec: docs/frontend/trustee-flows.md#wired-actions
import { useState, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  readEvmLoanChainState,
  readLoanChainState,
  updateEvmMutable,
  updateMutable,
  useEvmWallet,
  useStellarWallet,
  type UpdateMutableStage,
} from "@pipeline/wallet-connect";
import { ENV } from "@/lib/env";
import { pickChainWallet } from "@/lib/chainWallet";
import { isStellarTarget, loanActionChainReason } from "@/lib/targetChains";

export type { UpdateMutableStage };

export interface UseUpdateLifecycleInput {
  loanId: number;
  status: string;
  metadataUri: string;
  chainId: number | null | undefined;
}

export interface LoanMutableState {
  status: string;
  metadataUri: string;
}

export function useLoanMutableState(
  chainId: number | null | undefined,
  loanId: number | null,
  enabled: boolean,
) {
  return useQuery<LoanMutableState, Error>({
    queryKey: ["loan-mutable", chainId, loanId],
    enabled:
      enabled &&
      loanActionChainReason(chainId) === null &&
      Number.isInteger(loanId) &&
      !!(isStellarTarget(chainId)
        ? ENV.STELLAR_LOAN_REGISTRY_ID
        : ENV.EVM_LOAN_REGISTRY_ADDRESS),
    staleTime: 0,
    retry: false,
    queryFn: async () => {
      if (!isStellarTarget(chainId)) {
        const state = await readEvmLoanChainState({
          registry: ENV.EVM_LOAN_REGISTRY_ADDRESS,
          loanId: loanId as number,
        });
        return { status: state.status, metadataUri: state.metadataUri };
      }
      const state = await readLoanChainState({
        registryId: ENV.STELLAR_LOAN_REGISTRY_ID,
        loanId: loanId as number,
        rpcUrl: ENV.STELLAR_RPC_URL,
        networkPassphrase: ENV.STELLAR_NETWORK_PASSPHRASE,
      });
      return { status: state.status, metadataUri: state.metadataUri };
    },
  });
}

export interface UseUpdateLifecycleResult {
  mutate: (input: UseUpdateLifecycleInput) => void;
  mutateAsync: (input: UseUpdateLifecycleInput) => Promise<{ hash: string }>;
  isPending: boolean;
  isSuccess: boolean;
  error: Error | null;
  stage: UpdateMutableStage | null;
  reset: () => void;
}

export function useUpdateLifecycle(): UseUpdateLifecycleResult {
  const stellar = useStellarWallet();
  const evm = useEvmWallet();
  const [stage, setStage] = useState<UpdateMutableStage | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation<
    { hash: string },
    Error,
    UseUpdateLifecycleInput
  >({
    mutationFn: async ({ loanId, status, metadataUri, chainId }) => {
      setStage(null);
      const wallet = pickChainWallet(chainId, stellar, evm);

      if (wallet.kind === "evm") {
        const blocked = loanActionChainReason(chainId);
        if (blocked) throw new Error(blocked);
        if (!ENV.EVM_LOAN_REGISTRY_ADDRESS || !ENV.EVM_ACCESS_MANAGER_ADDRESS) {
          throw new Error(
            "On-chain lifecycle updates are not configured for this environment.",
          );
        }
        if (!wallet.isConnected || !wallet.address) {
          throw new Error("EVM wallet not connected.");
        }
        return updateEvmMutable({
          accessManager: ENV.EVM_ACCESS_MANAGER_ADDRESS,
          registry: ENV.EVM_LOAN_REGISTRY_ADDRESS,
          caller: wallet.address,
          chainId: ENV.EVM_CHAIN_ID,
          loanId,
          status,
          metadataUri,
          onStageChange: setStage,
        });
      }

      if (
        !ENV.STELLAR_LOAN_REGISTRY_ID ||
        !ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID
      ) {
        throw new Error(
          "On-chain lifecycle updates are not configured for this environment.",
        );
      }
      if (!stellar.isConnected || !stellar.address) {
        throw new Error("Stellar wallet not connected.");
      }

      return updateMutable({
        executorId: ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID,
        targetId: ENV.STELLAR_LOAN_REGISTRY_ID,
        caller: stellar.address,
        loanId,
        status,
        metadataUri,
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
      void queryClient.invalidateQueries({ queryKey: ["loan-mutable"] });
      void queryClient.invalidateQueries({ queryKey: ["risk-council-loan"] });
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
