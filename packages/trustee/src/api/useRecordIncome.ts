// spec: docs/frontend/trustee-flows.md#cash-reporter-bookings
import { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  recordIncome,
  readRefHashSeen,
  bankReferenceRefHash,
  useStellarWallet,
  type RecordIncomeStage,
  type RecordIncomeResult,
} from "@pipeline/wallet-connect";
import { ENV } from "@/lib/env";

export type { RecordIncomeStage };

export interface UseRecordIncomeInput {
  amount: string;
  valueDate: number;
  reference: string;
}

export interface UseRecordIncomeResult {
  mutateAsync: (input: UseRecordIncomeInput) => Promise<RecordIncomeResult>;
  isPending: boolean;
  isSuccess: boolean;
  error: Error | null;
  stage: RecordIncomeStage | null;
  reset: () => void;
}

export function useRecordIncome(): UseRecordIncomeResult {
  const { address, isConnected, signTransaction } = useStellarWallet();
  const [stage, setStage] = useState<RecordIncomeStage | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation<RecordIncomeResult, Error, UseRecordIncomeInput>(
    {
      mutationFn: async ({ amount, valueDate, reference }) => {
        setStage(null);

        if (!ENV.STELLAR_YIELD_MINTER_ID) {
          throw new Error(
            "On-chain bank income booking is not configured for this environment.",
          );
        }
        if (!isConnected || !address) {
          throw new Error("Stellar wallet not connected.");
        }

        const rpcUrl = ENV.STELLAR_RPC_URL;
        const networkPassphrase = ENV.STELLAR_NETWORK_PASSPHRASE;
        const refHash = await bankReferenceRefHash(reference);
        const seen = await readRefHashSeen({
          minterId: ENV.STELLAR_YIELD_MINTER_ID,
          refHash,
          rpcUrl,
          networkPassphrase,
        });
        if (seen) {
          throw new Error(
            "RefHashSeen: this bank reference's ref_hash is already consumed on the minter.",
          );
        }

        return recordIncome({
          minterId: ENV.STELLAR_YIELD_MINTER_ID,
          caller: address,
          amount,
          valueDate,
          refHash,
          rpcUrl,
          networkPassphrase,
          signTransaction,
          onStageChange: setStage,
        });
      },
      onSuccess: () => {
        const invalidate = () => {
          void queryClient.invalidateQueries({
            queryKey: ["capital-allocation"],
          });
          void queryClient.invalidateQueries({ queryKey: ["audit-log"] });
        };
        invalidate();
        for (const delayMs of [5_000, 15_000]) {
          setTimeout(invalidate, delayMs);
        }
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
