// spec: docs/frontend/trustee-flows.md#chain-first-approve-ordering-831
import { useState, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  drawEvmLoan,
  drawLoan,
  useEvmWallet,
  useStellarWallet,
  type DrawLoanArgs,
  type DrawLoanStage,
} from "@pipeline/wallet-connect";
import { ENV } from "@/lib/env";
import { pickChainWallet } from "@/lib/chainWallet";
import { evmLoanRegistryConfig, evmPreflight } from "@/lib/evmPreflight";
import { drawChainReason } from "@/lib/targetChains";

export type { DrawLoanStage };

export interface UseDrawLoanInput {
  args: DrawLoanArgs;
  chainId: number | null | undefined;
}

export interface DrawLoanOutcome {
  hash: string;
  loanId: number | null;
}

export interface UseDrawLoanResult {
  mutateAsync: (input: UseDrawLoanInput) => Promise<DrawLoanOutcome>;
  isPending: boolean;
  isSuccess: boolean;
  error: Error | null;
  stage: DrawLoanStage | null;
  mintedLoanId: number | null;
  reset: () => void;
}

export function useDrawLoan(): UseDrawLoanResult {
  const stellar = useStellarWallet();
  const evm = useEvmWallet();
  const [stage, setStage] = useState<DrawLoanStage | null>(null);

  const mutation = useMutation<DrawLoanOutcome, Error, UseDrawLoanInput>({
    mutationFn: async ({ args, chainId }) => {
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
            "On-chain minting is not configured for this environment.",
          chainReason: drawChainReason,
        });
        return drawEvmLoan({
          accessManager: config.accessManager,
          registry: config.registry,
          caller,
          chainId: evmChainId,
          args,
          onStageChange: setStage,
        });
      }

      if (
        !ENV.STELLAR_LOAN_REGISTRY_ID ||
        !ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID
      ) {
        throw new Error(
          "On-chain minting is not configured for this environment.",
        );
      }
      if (!stellar.isConnected || !stellar.address) {
        throw new Error("Stellar wallet not connected.");
      }

      return drawLoan({
        executorId: ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID,
        targetId: ENV.STELLAR_LOAN_REGISTRY_ID,
        caller: stellar.address,
        args,
        rpcUrl: ENV.STELLAR_RPC_URL,
        networkPassphrase: ENV.STELLAR_NETWORK_PASSPHRASE,
        signTransaction: stellar.signTransaction,
        onStageChange: setStage,
      });
    },
  });

  const reset = useCallback(() => {
    setStage(null);
    mutation.reset();
  }, [mutation]);

  return {
    mutateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    isSuccess: mutation.isSuccess,
    error: mutation.error,
    stage,
    mintedLoanId: mutation.data?.loanId ?? null,
    reset,
  };
}
