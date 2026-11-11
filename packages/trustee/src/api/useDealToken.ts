// spec: docs/frontend/trustee-flows.md#register-debt-token-1766
import { useCallback, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  readCanCall,
  readDeal,
  readOperationSchedule,
  registerDeal,
  registerDealArgs,
  useStellarWallet,
  type CanCall,
  type DealRead,
  type OperationSchedule,
  type RelayMode,
  type RelayStage,
} from "@pipeline/wallet-connect";
import { ENV } from "@/lib/env";
import { stellarOnlyActionReason } from "@/lib/targetChains";
import { DEBT_TOKEN_NOT_CONFIGURED } from "@/lib/dealToken";

export type { RelayStage };

export interface RegisterDealAccess {
  canCall: CanCall;
  schedule: OperationSchedule | null;
}

export interface RegisterDealInput {
  mode: RelayMode;
  loanId: number;
  chainId: number | null | undefined;
}

const REGISTER_DEAL_FN = "register_deal";

export function dealTokenConfigured(): boolean {
  return (
    !!ENV.STELLAR_DEAL_TOKEN_FACTORY_ID &&
    !!ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID
  );
}

function rpc() {
  return {
    rpcUrl: ENV.STELLAR_RPC_URL,
    networkPassphrase: ENV.STELLAR_NETWORK_PASSPHRASE,
  };
}

function validLoanId(loanId: number | null | undefined): loanId is number {
  return loanId != null && Number.isInteger(loanId) && loanId >= 0;
}

export function useDeal(
  chainId: number | null | undefined,
  loanId: number | null | undefined,
) {
  return useQuery<DealRead | null, Error>({
    queryKey: ["deal-token", chainId ?? null, loanId ?? null],
    enabled:
      stellarOnlyActionReason(chainId) === null &&
      !!ENV.STELLAR_DEAL_TOKEN_FACTORY_ID &&
      validLoanId(loanId),
    staleTime: 15_000,
    retry: false,
    queryFn: () =>
      readDeal({
        factoryId: ENV.STELLAR_DEAL_TOKEN_FACTORY_ID,
        loanId: loanId as number,
        ...rpc(),
      }),
  });
}

export function useRegisterDealAccess(
  loanId: number | null | undefined,
  enabled: boolean,
) {
  const { address } = useStellarWallet();
  return useQuery<RegisterDealAccess, Error>({
    queryKey: ["register-deal-access", address, loanId ?? null],
    enabled:
      enabled && !!address && dealTokenConfigured() && validLoanId(loanId),
    staleTime: 5_000,
    retry: false,
    queryFn: async () => {
      if (!dealTokenConfigured()) throw new Error(DEBT_TOKEN_NOT_CONFIGURED);
      const base = {
        accessManagerId: ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID,
        caller: address!,
        target: ENV.STELLAR_DEAL_TOKEN_FACTORY_ID,
        fn: REGISTER_DEAL_FN,
        ...rpc(),
      };
      const canCall = await readCanCall(base);
      const schedule =
        !canCall.immediate && canCall.delay > 0
          ? await readOperationSchedule({
              ...base,
              args: registerDealArgs(loanId as number),
            })
          : null;
      return { canCall, schedule };
    },
  });
}

function invalidateDealToken(queryClient: QueryClient) {
  for (const key of ["deal-token", "register-deal-access", "audit-log"]) {
    void queryClient.invalidateQueries({ queryKey: [key] });
  }
}

export function useRegisterDeal() {
  const { address, isConnected, signTransaction } = useStellarWallet();
  const [stage, setStage] = useState<RelayStage | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation<{ hash: string }, Error, RegisterDealInput>({
    mutationFn: async ({ mode, loanId, chainId }) => {
      setStage(null);
      const blocked = stellarOnlyActionReason(chainId);
      if (blocked) throw new Error(blocked);
      if (!dealTokenConfigured()) throw new Error(DEBT_TOKEN_NOT_CONFIGURED);
      if (!isConnected || !address) {
        throw new Error("Stellar wallet not connected.");
      }
      return registerDeal({
        mode,
        accessManagerId: ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID,
        factoryId: ENV.STELLAR_DEAL_TOKEN_FACTORY_ID,
        loanId,
        caller: address,
        signTransaction,
        onStageChange: setStage,
        ...rpc(),
      });
    },
    onSuccess: () => {
      invalidateDealToken(queryClient);
      setTimeout(() => invalidateDealToken(queryClient), 5_000);
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
    reset,
  };
}
