// spec: docs/frontend/trustee-flows.md#cash-management--conversions-and-bank-charges
import { useCallback, useState } from "react";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  closeRamp,
  openRamp,
  readCanCall,
  readMinterPaused,
  readMinterPoolState,
  readMinterRamp,
  recordExpense,
  useStellarWallet,
  type CanCall,
  type MinterPoolState,
  type MinterRamp,
  type RampDirection,
  type RelayStage,
} from "@pipeline/wallet-connect";
import { ENV } from "@/lib/env";

export type ConversionFn = "open_ramp" | "close_ramp" | "record_expense";

const NOT_CONFIGURED =
  "Conversion and bank-charge actions are not configured for this environment.";

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

export function minterRampKey(minterId: string, id: number) {
  return ["minter-ramp", minterId, id] as const;
}

export function minterPoolStateKey(minterId: string) {
  return ["minter-pool-state", minterId] as const;
}

export function minterPausedKey(minterId: string) {
  return ["minter-paused", minterId] as const;
}

export function fetchMinterRamp(id: number): Promise<MinterRamp> {
  return readMinterRamp({
    minterId: ENV.STELLAR_YIELD_MINTER_ID,
    id,
    ...rpc(),
  });
}

export function fetchMinterPaused(): Promise<boolean> {
  return readMinterPaused({ minterId: ENV.STELLAR_YIELD_MINTER_ID, ...rpc() });
}

export function useMinterRamps(ids: number[], enabled = true) {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: minterRampKey(ENV.STELLAR_YIELD_MINTER_ID, id),
      queryFn: () => fetchMinterRamp(id),
      enabled: enabled && !!ENV.STELLAR_YIELD_MINTER_ID,
      staleTime: 0,
      retry: false,
    })),
  });
}

export function useMinterPoolState(enabled: boolean) {
  return useQuery<MinterPoolState, Error>({
    queryKey: minterPoolStateKey(ENV.STELLAR_YIELD_MINTER_ID),
    enabled: enabled && !!ENV.STELLAR_YIELD_MINTER_ID,
    refetchInterval: 30_000,
    retry: false,
    queryFn: () =>
      readMinterPoolState({ minterId: ENV.STELLAR_YIELD_MINTER_ID, ...rpc() }),
  });
}

export function useMinterPaused(enabled: boolean) {
  return useQuery<boolean, Error>({
    queryKey: minterPausedKey(ENV.STELLAR_YIELD_MINTER_ID),
    enabled: enabled && !!ENV.STELLAR_YIELD_MINTER_ID,
    staleTime: 30_000,
    retry: false,
    queryFn: fetchMinterPaused,
  });
}

export function useConversionAccess(fn: ConversionFn, enabled: boolean) {
  const { address } = useStellarWallet();
  return useQuery<CanCall, Error>({
    queryKey: ["conversion-access", address, fn],
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

export interface OpenRampInput {
  direction: RampDirection;
  amountRaw: string;
  refHash: string;
}

export interface CloseRampInput {
  id: number;
  receivedRaw: string;
  refHash: string;
}

export interface RecordExpenseInput {
  deltaRaw: string;
  valueDate: number;
  refHash: string;
}

export interface UseConversionMutationResult<I> {
  mutateAsync: (input: I) => Promise<{ hash: string }>;
  isPending: boolean;
  error: Error | null;
  stage: RelayStage | null;
  reset: () => void;
}

interface RunContext {
  caller: string;
  signTransaction: Parameters<typeof openRamp>[0]["signTransaction"];
  onStageChange: (stage: RelayStage) => void;
}

function useConversionMutation<I>(
  run: (input: I, ctx: RunContext) => Promise<{ hash: string }>,
  rampId: (input: I) => number | null,
): UseConversionMutationResult<I> {
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
    onSuccess: (_result, input) => {
      void queryClient.invalidateQueries({ queryKey: ["cash-book"] });
      void queryClient.invalidateQueries({
        queryKey: minterPoolStateKey(ENV.STELLAR_YIELD_MINTER_ID),
      });
      const id = rampId(input);
      if (id !== null) {
        void queryClient.invalidateQueries({
          queryKey: minterRampKey(ENV.STELLAR_YIELD_MINTER_ID, id),
        });
      }
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

export function useOpenRamp(): UseConversionMutationResult<OpenRampInput> {
  return useConversionMutation<OpenRampInput>(
    (
      { direction, amountRaw, refHash },
      { caller, signTransaction, onStageChange },
    ) =>
      openRamp({
        accessManagerId: ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID,
        minterId: ENV.STELLAR_YIELD_MINTER_ID,
        caller,
        direction,
        amountRaw,
        refHash,
        signTransaction,
        onStageChange,
        ...rpc(),
      }),
    () => null,
  );
}

export function useCloseRamp(): UseConversionMutationResult<CloseRampInput> {
  return useConversionMutation<CloseRampInput>(
    (
      { id, receivedRaw, refHash },
      { caller, signTransaction, onStageChange },
    ) =>
      closeRamp({
        accessManagerId: ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID,
        minterId: ENV.STELLAR_YIELD_MINTER_ID,
        caller,
        id,
        receivedRaw,
        refHash,
        signTransaction,
        onStageChange,
        ...rpc(),
      }),
    ({ id }) => id,
  );
}

export function useRecordExpense(): UseConversionMutationResult<RecordExpenseInput> {
  return useConversionMutation<RecordExpenseInput>(
    (
      { deltaRaw, valueDate, refHash },
      { caller, signTransaction, onStageChange },
    ) =>
      recordExpense({
        accessManagerId: ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID,
        minterId: ENV.STELLAR_YIELD_MINTER_ID,
        caller,
        deltaRaw,
        valueDate,
        refHash,
        signTransaction,
        onStageChange,
        ...rpc(),
      }),
    () => null,
  );
}
