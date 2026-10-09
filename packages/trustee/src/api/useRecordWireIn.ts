// spec: docs/frontend/trustee-flows.md#lp-bank-deposits
import { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  recordWireIn,
  useStellarWallet,
  type RecordWireInStage,
  type RecordWireInResult,
} from "@pipeline/wallet-connect";
import { ENV } from "@/lib/env";
import { lpBankDepositsKey } from "./useLpBankDeposits";

export type { RecordWireInStage };

export interface UseRecordWireInInput {
  lpId: number;
  depositId: number;
  receiver: string;
  amount: string;
  occurredAt: string;
  refHash: string;
}

export interface UseRecordWireInResult {
  mutateAsync: (input: UseRecordWireInInput) => Promise<RecordWireInResult>;
  isPending: boolean;
  isSuccess: boolean;
  error: Error | null;
  stage: RecordWireInStage | null;
  reset: () => void;
}

export function toValueDateSeconds(occurredAt: string): number {
  const ms = Date.parse(occurredAt);
  if (!Number.isFinite(ms)) {
    throw new Error(
      `Could not read the deposit's receipt time "${occurredAt}".`,
    );
  }
  return Math.floor(ms / 1000);
}

export function useRecordWireIn(): UseRecordWireInResult {
  const { address, isConnected, signTransaction } = useStellarWallet();
  const [stage, setStage] = useState<RecordWireInStage | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation<RecordWireInResult, Error, UseRecordWireInInput>(
    {
      mutationFn: async ({ receiver, amount, occurredAt, refHash }) => {
        setStage(null);

        if (!ENV.STELLAR_YIELD_MINTER_ID) {
          throw new Error(
            "On-chain PLUSD minting is not configured for this environment.",
          );
        }
        if (!isConnected || !address) {
          throw new Error("Stellar wallet not connected.");
        }
        if (!receiver) {
          throw new Error(
            "This LP has no linked Stellar wallet and no custody account is configured.",
          );
        }

        return recordWireIn({
          minterId: ENV.STELLAR_YIELD_MINTER_ID,
          caller: address,
          receiver,
          amount,
          valueDate: toValueDateSeconds(occurredAt),
          refHash,
          rpcUrl: ENV.STELLAR_RPC_URL,
          networkPassphrase: ENV.STELLAR_NETWORK_PASSPHRASE,
          signTransaction,
          onStageChange: setStage,
        });
      },
      onSuccess: (_result, { lpId }) => {
        void queryClient.invalidateQueries({
          queryKey: lpBankDepositsKey(lpId),
        });
        void queryClient.invalidateQueries({ queryKey: ["lp", lpId] });
      },
    },
  );

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
    reset,
  };
}
