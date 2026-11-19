// spec: docs/frontend/trustee-flows.md#register-debt-token-1766
import { useCallback, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  encodeEvmRegisterDealCalldata,
  evmRegisterDealSelector,
  readCanCall,
  readDeal,
  readEvmCanCall,
  readEvmDeal,
  readEvmOperationSchedule,
  readOperationSchedule,
  registerDeal,
  registerDealArgs,
  relayEvmRegisterDeal,
  useEvmWallet,
  useStellarWallet,
  type CanCall,
  type DealRead,
  type OperationSchedule,
  type RelayMode,
  type RelayStage,
} from "@pipeline/wallet-connect";
import { ENV } from "@/lib/env";
import { pickChainWallet, useChainWallet } from "@/lib/chainWallet";
import {
  isStellarTarget,
  loanActionChainReason,
  stellarOnlyActionReason,
} from "@/lib/targetChains";
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

export function dealTokenConfigured(
  chainId?: number | null | undefined,
): boolean {
  if (!isStellarTarget(chainId)) {
    return (
      !!ENV.EVM_DEAL_TOKEN_FACTORY_ADDRESS && !!ENV.EVM_ACCESS_MANAGER_ADDRESS
    );
  }
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

export function useEvmDeal(
  chainId: number | null | undefined,
  loanId: number | null | undefined,
) {
  return useQuery<DealRead | null, Error>({
    queryKey: ["evm-deal-token", chainId ?? null, loanId ?? null],
    enabled:
      !isStellarTarget(chainId) &&
      loanActionChainReason(chainId) === null &&
      !!ENV.EVM_DEAL_TOKEN_FACTORY_ADDRESS &&
      validLoanId(loanId),
    staleTime: 15_000,
    retry: false,
    queryFn: () =>
      readEvmDeal({
        factory: ENV.EVM_DEAL_TOKEN_FACTORY_ADDRESS,
        loanId: loanId as number,
      }),
  });
}

export function useLoanDeal(
  chainId: number | null | undefined,
  loanId: number | null | undefined,
) {
  const stellar = useDeal(chainId, loanId);
  const evm = useEvmDeal(chainId, loanId);
  return isStellarTarget(chainId) ? stellar : evm;
}

export function useRegisterDealAccess(
  chainId: number | null | undefined,
  loanId: number | null | undefined,
  enabled: boolean,
) {
  const { address } = useChainWallet(chainId);
  return useQuery<RegisterDealAccess, Error>({
    queryKey: [
      "register-deal-access",
      chainId ?? null,
      address,
      loanId ?? null,
    ],
    enabled:
      enabled &&
      !!address &&
      loanActionChainReason(chainId) === null &&
      dealTokenConfigured(chainId) &&
      validLoanId(loanId),
    staleTime: 5_000,
    retry: false,
    queryFn: async () => {
      if (!dealTokenConfigured(chainId)) {
        throw new Error(DEBT_TOKEN_NOT_CONFIGURED);
      }
      if (!isStellarTarget(chainId)) {
        const evmBase = {
          accessManager: ENV.EVM_ACCESS_MANAGER_ADDRESS,
          caller: address!,
          target: ENV.EVM_DEAL_TOKEN_FACTORY_ADDRESS,
        };
        const canCall = await readEvmCanCall({
          ...evmBase,
          selector: evmRegisterDealSelector(),
        });
        const schedule =
          !canCall.immediate && canCall.delay > 0
            ? await readEvmOperationSchedule({
                ...evmBase,
                data: encodeEvmRegisterDealCalldata(loanId as number),
              })
            : null;
        return { canCall, schedule };
      }
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
  for (const key of [
    "deal-token",
    "evm-deal-token",
    "register-deal-access",
    "audit-log",
  ]) {
    void queryClient.invalidateQueries({ queryKey: [key] });
  }
}

export function useRegisterDeal() {
  const stellar = useStellarWallet();
  const evm = useEvmWallet();
  const [stage, setStage] = useState<RelayStage | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation<{ hash: string }, Error, RegisterDealInput>({
    mutationFn: async ({ mode, loanId, chainId }) => {
      setStage(null);
      const wallet = pickChainWallet(chainId, stellar, evm);
      const blocked = loanActionChainReason(chainId);
      if (blocked) throw new Error(blocked);
      if (!dealTokenConfigured(chainId)) {
        throw new Error(DEBT_TOKEN_NOT_CONFIGURED);
      }
      if (!wallet.isConnected || !wallet.address) {
        throw new Error(
          wallet.kind === "evm"
            ? "EVM wallet not connected."
            : "Stellar wallet not connected.",
        );
      }
      if (wallet.kind === "evm") {
        return relayEvmRegisterDeal({
          mode,
          accessManager: ENV.EVM_ACCESS_MANAGER_ADDRESS,
          factory: ENV.EVM_DEAL_TOKEN_FACTORY_ADDRESS,
          caller: wallet.address,
          loanId,
          chainId: ENV.EVM_CHAIN_ID,
          onStageChange: setStage,
        });
      }
      return registerDeal({
        mode,
        accessManagerId: ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID,
        factoryId: ENV.STELLAR_DEAL_TOKEN_FACTORY_ID,
        loanId,
        caller: wallet.address,
        signTransaction: stellar.signTransaction,
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
