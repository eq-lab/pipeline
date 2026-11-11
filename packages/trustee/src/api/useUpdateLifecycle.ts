// spec: docs/frontend/trustee-flows.md#wired-actions
import { useState, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  readLoanChainState,
  updateMutable,
  useStellarWallet,
  type UpdateMutableStage,
} from "@pipeline/wallet-connect";
import { ENV } from "@/lib/env";
import { stellarOnlyActionReason } from "@/lib/targetChains";

export type { UpdateMutableStage };

export interface UseUpdateLifecycleInput {
  loanId: number;
  status: string;
  metadataUri: string;
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
      stellarOnlyActionReason(chainId) === null &&
      Number.isInteger(loanId) &&
      !!ENV.STELLAR_LOAN_REGISTRY_ID,
    staleTime: 0,
    retry: false,
    queryFn: async () => {
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
  const { address, isConnected, signTransaction } = useStellarWallet();
  const [stage, setStage] = useState<UpdateMutableStage | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation<
    { hash: string },
    Error,
    UseUpdateLifecycleInput
  >({
    mutationFn: async ({ loanId, status, metadataUri }) => {
      setStage(null);

      if (
        !ENV.STELLAR_LOAN_REGISTRY_ID ||
        !ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID
      ) {
        throw new Error(
          "On-chain lifecycle updates are not configured for this environment.",
        );
      }
      if (!isConnected || !address) {
        throw new Error("Stellar wallet not connected.");
      }

      return updateMutable({
        executorId: ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID,
        targetId: ENV.STELLAR_LOAN_REGISTRY_ID,
        caller: address,
        loanId,
        status,
        metadataUri,
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
