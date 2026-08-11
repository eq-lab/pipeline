/**
 * React Query mutation hook — wraps `@pipeline/wallet-connect`'s
 * `updateMutable`: the trustee-wallet-signed on-chain
 * `LoanRegistry.updateMutable`, run through the executor `execute` proxy
 * (same pattern as `useRollover`). Non-economic fields only (status / CCR /
 * location / metadata URI), no NAV impact.
 *
 * spec: docs/frontend/trustee-flows.md#wired-actions (Update lifecycle).
 */
import { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  updateMutable,
  useStellarWallet,
  type UpdateMutableStage,
  type LocationInput,
} from "@pipeline/wallet-connect";
import { ENV } from "@/lib/env";

export type { UpdateMutableStage, LocationInput };

export interface UseUpdateLifecycleInput {
  /** On-chain loan id (u32). */
  loanId: number;
  /** On-chain `LoanStatus` variant: `Performing` | `WatchList`. */
  status: string;
  /** New CCR as a percent (e.g. `135`); scaled to `ONE = 1e6` in the binding. */
  ccrPercent: number;
  /** New collateral location — the `LocationUpdate` struct the contract expects. */
  location: LocationInput;
  /** Optional metadata URI (assay / offtake hash); pass "" when blank. */
  metadataUri: string;
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
    mutationFn: async ({
      loanId,
      status,
      ccrPercent,
      location,
      metadataUri,
    }) => {
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
        ccrPercent,
        location,
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
