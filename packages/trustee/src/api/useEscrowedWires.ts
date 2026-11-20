// spec: docs/frontend/trustee-flows.md#cash-management--escrowed-wires
import { useCallback, useState } from "react";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  assignWireIn,
  readCanCall,
  readMinterPlusdId,
  readMinterWireIn,
  returnWireIn,
  useStellarWallet,
  type CanCall,
  type MinterWireIn,
  type RelayStage,
} from "@pipeline/wallet-connect";
import { ENV } from "@/lib/env";

export type WireEscrowFn = "assign_wire_in" | "return_wire_in";

const NOT_CONFIGURED =
  "Escrowed-wire actions are not configured for this environment.";

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

export function minterWireInKey(minterId: string, id: number) {
  return ["minter-wire-in", minterId, id] as const;
}

export function fetchMinterWireIn(id: number): Promise<MinterWireIn> {
  return readMinterWireIn({
    minterId: ENV.STELLAR_YIELD_MINTER_ID,
    id,
    ...rpc(),
  });
}

export function useMinterWireIns(ids: number[], enabled = true) {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: minterWireInKey(ENV.STELLAR_YIELD_MINTER_ID, id),
      queryFn: () => fetchMinterWireIn(id),
      enabled: enabled && !!ENV.STELLAR_YIELD_MINTER_ID,
      staleTime: 0,
      retry: false,
    })),
  });
}

export function minterPlusdQuery(minterId: string) {
  return {
    queryKey: ["minter-plusd", minterId] as const,
    queryFn: () => readMinterPlusdId({ minterId, ...rpc() }),
    staleTime: Infinity,
  };
}

export function ensureMinterPlusdId(queryClient: QueryClient): Promise<string> {
  if (!ENV.STELLAR_YIELD_MINTER_ID) throw new Error(NOT_CONFIGURED);
  return queryClient.ensureQueryData(
    minterPlusdQuery(ENV.STELLAR_YIELD_MINTER_ID),
  );
}

export function useMinterPlusdId(enabled = true) {
  return useQuery<string, Error>({
    ...minterPlusdQuery(ENV.STELLAR_YIELD_MINTER_ID),
    enabled: enabled && !!ENV.STELLAR_YIELD_MINTER_ID,
    retry: false,
  });
}

export function useWireEscrowAccess(fn: WireEscrowFn, enabled: boolean) {
  const { address } = useStellarWallet();
  return useQuery<CanCall, Error>({
    queryKey: ["wire-escrow-access", address, fn],
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

export interface AssignWireInput {
  id: number;
  receiver: string;
}

export interface ReturnWireInput {
  id: number;
  refHash: string;
}

export interface UseWireEscrowMutationResult<I> {
  mutateAsync: (input: I) => Promise<{ hash: string }>;
  isPending: boolean;
  error: Error | null;
  stage: RelayStage | null;
  reset: () => void;
}

function useWireEscrowMutation<I extends { id: number }>(
  run: (
    input: I,
    ctx: {
      caller: string;
      signTransaction: Parameters<typeof assignWireIn>[0]["signTransaction"];
      onStageChange: (stage: RelayStage) => void;
    },
  ) => Promise<{ hash: string }>,
): UseWireEscrowMutationResult<I> {
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
        queryKey: minterWireInKey(ENV.STELLAR_YIELD_MINTER_ID, id),
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

export function useAssignWireIn(): UseWireEscrowMutationResult<AssignWireInput> {
  return useWireEscrowMutation<AssignWireInput>(
    ({ id, receiver }, { caller, signTransaction, onStageChange }) =>
      assignWireIn({
        accessManagerId: ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID,
        minterId: ENV.STELLAR_YIELD_MINTER_ID,
        caller,
        id,
        receiver,
        signTransaction,
        onStageChange,
        ...rpc(),
      }),
  );
}

export function useReturnWireIn(): UseWireEscrowMutationResult<ReturnWireInput> {
  return useWireEscrowMutation<ReturnWireInput>(
    ({ id, refHash }, { caller, signTransaction, onStageChange }) =>
      returnWireIn({
        accessManagerId: ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID,
        minterId: ENV.STELLAR_YIELD_MINTER_ID,
        caller,
        id,
        refHash,
        signTransaction,
        onStageChange,
        ...rpc(),
      }),
  );
}
