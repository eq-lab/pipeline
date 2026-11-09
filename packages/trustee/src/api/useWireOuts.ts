// spec: docs/frontend/trustee-flows.md#cash-management--bank-wire-outs
import { useCallback, useState } from "react";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  cancelWireOut,
  readCanCall,
  readWireOutRecord,
  settleWireOut,
  useStellarWallet,
  type CanCall,
  type RelayStage,
  type WireOutRecord,
} from "@pipeline/wallet-connect";
import { ENV } from "@/lib/env";

export type WireOutFn = "settle_wire_out" | "cancel_wire_out";

const NOT_CONFIGURED =
  "Bank wire-out actions are not configured for this environment.";

function rpc() {
  return {
    rpcUrl: ENV.STELLAR_RPC_URL,
    networkPassphrase: ENV.STELLAR_NETWORK_PASSPHRASE,
  };
}

function configured(): boolean {
  return (
    !!ENV.STELLAR_YIELD_MINTER_ID && !!ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID
  );
}

export function wireOutRecordKey(minterId: string, id: number) {
  return ["minter-wire-out", minterId, id] as const;
}

export function fetchWireOutRecord(id: number): Promise<WireOutRecord> {
  return readWireOutRecord({
    minterId: ENV.STELLAR_YIELD_MINTER_ID,
    id,
    ...rpc(),
  });
}

export function useWireOutRecords(ids: number[], enabled = true) {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: wireOutRecordKey(ENV.STELLAR_YIELD_MINTER_ID, id),
      queryFn: () => fetchWireOutRecord(id),
      enabled: enabled && !!ENV.STELLAR_YIELD_MINTER_ID,
      staleTime: 0,
      retry: false,
    })),
  });
}

export function useWireOutAccess(fn: WireOutFn, enabled: boolean) {
  const { address } = useStellarWallet();
  return useQuery<CanCall, Error>({
    queryKey: ["wire-out-access", address, fn],
    enabled: enabled && !!address && configured(),
    staleTime: 30_000,
    retry: false,
    queryFn: () => {
      if (!configured()) throw new Error(NOT_CONFIGURED);
      return readCanCall({
        accessManagerId: ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID,
        caller: address!,
        target: ENV.STELLAR_YIELD_MINTER_ID,
        fn,
        ...rpc(),
      });
    },
  });
}

export interface SettleWireOutInput {
  id: number;
  amountRaw: string;
  valueDate: number;
  refHash: string;
}

export interface CancelWireOutInput {
  id: number;
}

export interface UseWireOutMutationResult<I> {
  mutateAsync: (input: I) => Promise<{ hash: string }>;
  isPending: boolean;
  error: Error | null;
  stage: RelayStage | null;
  reset: () => void;
}

function useWireOutMutation<I extends { id: number }>(
  run: (
    input: I,
    ctx: {
      caller: string;
      signTransaction: Parameters<typeof settleWireOut>[0]["signTransaction"];
      onStageChange: (stage: RelayStage) => void;
    },
  ) => Promise<{ hash: string }>,
): UseWireOutMutationResult<I> {
  const { address, isConnected, signTransaction } = useStellarWallet();
  const [stage, setStage] = useState<RelayStage | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation<{ hash: string }, Error, I>({
    mutationFn: async (input) => {
      setStage(null);
      if (!configured()) throw new Error(NOT_CONFIGURED);
      if (!isConnected || !address) {
        throw new Error("Stellar wallet not connected.");
      }
      return run(input, {
        caller: address,
        signTransaction,
        onStageChange: setStage,
      });
    },
    onSuccess: (_result, { id }) => {
      void queryClient.invalidateQueries({ queryKey: ["cash-book"] });
      void queryClient.invalidateQueries({
        queryKey: wireOutRecordKey(ENV.STELLAR_YIELD_MINTER_ID, id),
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
    error: mutation.error,
    stage,
    reset,
  };
}

export function useSettleWireOut(): UseWireOutMutationResult<SettleWireOutInput> {
  return useWireOutMutation<SettleWireOutInput>(
    (
      { id, amountRaw, valueDate, refHash },
      { caller, signTransaction, onStageChange },
    ) =>
      settleWireOut({
        accessManagerId: ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID,
        minterId: ENV.STELLAR_YIELD_MINTER_ID,
        caller,
        id,
        amountRaw,
        valueDate,
        refHash,
        signTransaction,
        onStageChange,
        ...rpc(),
      }),
  );
}

export function useCancelWireOut(): UseWireOutMutationResult<CancelWireOutInput> {
  return useWireOutMutation<CancelWireOutInput>(
    ({ id }, { caller, signTransaction, onStageChange }) =>
      cancelWireOut({
        accessManagerId: ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID,
        minterId: ENV.STELLAR_YIELD_MINTER_ID,
        caller,
        id,
        signTransaction,
        onStageChange,
        ...rpc(),
      }),
  );
}
