// spec: docs/frontend/trustee-flows.md#disburse-1898
import { useCallback, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  bankReferenceRefHash,
  disburse,
  disburseEvmLoan,
  evmDisburseSelector,
  readCanCall,
  readDebtTrustline,
  readEvmCanCall,
  readEvmLoanDisbursementState,
  readEvmMinterBankCash,
  readEvmMinterPaused,
  readEvmRefHashSeen,
  readLoanDisbursementState,
  readLoanOwner,
  readRefHashSeen,
  useEvmWallet,
  useStellarWallet,
  type CanCall,
  type LoanDisbursementState,
  type RelayStage,
} from "@pipeline/wallet-connect";
import { ENV } from "@/lib/env";
import { pickChainWallet, useChainWallet } from "@/lib/chainWallet";
import { isStellarTarget, loanActionChainReason } from "@/lib/targetChains";
import {
  DISBURSE_NOT_CONFIGURED,
  MINTER_PAUSED,
  REUSED_DISBURSE_REFERENCE,
  type DebtTrustlineRead,
} from "@/lib/disburse";
import { fetchMinterPaused, minterPoolStateKey } from "./useConversions";

export type { RelayStage };

export interface DisburseInput {
  chainId: number | null | undefined;
  loanId: number;
  amountRaw: string;
  valueDate: number;
  reference: string;
}

const RECHECK_DELAYS_MS = [5_000, 15_000];
const INVALIDATED_KEYS = [
  "loan-disbursement",
  "loan-mutable",
  "loan-book",
  "loan-financials",
  "loan-security",
  "loan-waterfall",
  "cash-book",
  "deal-token",
  "debt-trustline",
  "audit-log",
  "evm-minter-bank-cash",
  "evm-minter-paused",
];

export function disburseConfigured(
  chainId?: number | null | undefined,
): boolean {
  if (!isStellarTarget(chainId)) {
    return (
      !!ENV.EVM_MINTER_ADDRESS &&
      !!ENV.EVM_ACCESS_MANAGER_ADDRESS &&
      !!ENV.EVM_LOAN_REGISTRY_ADDRESS &&
      !!ENV.EVM_DEAL_TOKEN_FACTORY_ADDRESS
    );
  }
  return (
    !!ENV.STELLAR_YIELD_MINTER_ID &&
    !!ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID &&
    !!ENV.STELLAR_LOAN_REGISTRY_ID &&
    !!ENV.STELLAR_DEAL_TOKEN_FACTORY_ID
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

export function useLoanDisbursementState(
  chainId: number | null | undefined,
  loanId: number | null | undefined,
) {
  return useQuery<LoanDisbursementState, Error>({
    queryKey: ["loan-disbursement", chainId ?? null, loanId ?? null],
    enabled:
      loanActionChainReason(chainId) === null &&
      disburseConfigured(chainId) &&
      validLoanId(loanId),
    staleTime: 15_000,
    retry: false,
    queryFn: () =>
      isStellarTarget(chainId)
        ? readLoanDisbursementState({
            registryId: ENV.STELLAR_LOAN_REGISTRY_ID,
            loanId: loanId as number,
            ...rpc(),
          })
        : readEvmLoanDisbursementState({
            registry: ENV.EVM_LOAN_REGISTRY_ADDRESS,
            loanId: loanId as number,
          }),
  });
}

export function useDebtTrustline(
  chainId: number | null | undefined,
  loanId: number | null | undefined,
  debt: string | null | undefined,
) {
  return useQuery<DebtTrustlineRead, Error>({
    queryKey: ["debt-trustline", chainId ?? null, loanId ?? null, debt ?? null],
    enabled:
      !!debt &&
      isStellarTarget(chainId) &&
      disburseConfigured(chainId) &&
      validLoanId(loanId),
    staleTime: 15_000,
    retry: false,
    queryFn: async () => {
      const holder = await readLoanOwner({
        registryId: ENV.STELLAR_LOAN_REGISTRY_ID,
        loanId: loanId as number,
        ...rpc(),
      });
      const trustline = await readDebtTrustline({
        debtId: debt as string,
        holder,
        ...rpc(),
      });
      return { holder, trustline };
    },
  });
}

export function useEvmMinterBankCash(enabled: boolean) {
  return useQuery<string, Error>({
    queryKey: ["evm-minter-bank-cash", ENV.EVM_MINTER_ADDRESS],
    enabled: enabled && !!ENV.EVM_MINTER_ADDRESS,
    refetchInterval: 30_000,
    retry: false,
    queryFn: () => readEvmMinterBankCash({ minter: ENV.EVM_MINTER_ADDRESS }),
  });
}

export function useEvmMinterPaused(enabled: boolean) {
  return useQuery<boolean, Error>({
    queryKey: ["evm-minter-paused", ENV.EVM_MINTER_ADDRESS],
    enabled: enabled && !!ENV.EVM_MINTER_ADDRESS,
    staleTime: 30_000,
    retry: false,
    queryFn: () => readEvmMinterPaused({ minter: ENV.EVM_MINTER_ADDRESS }),
  });
}

export function useDisburseAccess(
  chainId: number | null | undefined,
  enabled: boolean,
) {
  const { address } = useChainWallet(chainId);
  const stellar = isStellarTarget(chainId);
  return useQuery<CanCall, Error>({
    queryKey: ["disburse-access", chainId ?? null, address],
    enabled: enabled && !!address && disburseConfigured(chainId),
    staleTime: 30_000,
    retry: false,
    queryFn: () =>
      stellar
        ? readCanCall({
            accessManagerId: ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID,
            caller: address!,
            target: ENV.STELLAR_YIELD_MINTER_ID,
            fn: "disburse",
            ...rpc(),
          })
        : readEvmCanCall({
            accessManager: ENV.EVM_ACCESS_MANAGER_ADDRESS,
            caller: address!,
            target: ENV.EVM_MINTER_ADDRESS,
            selector: evmDisburseSelector(),
          }),
  });
}

function invalidateDisburse(queryClient: QueryClient) {
  for (const key of INVALIDATED_KEYS) {
    void queryClient.invalidateQueries({ queryKey: [key] });
  }
  void queryClient.invalidateQueries({
    queryKey: minterPoolStateKey(ENV.STELLAR_YIELD_MINTER_ID),
  });
}

export function useDisburse() {
  const stellar = useStellarWallet();
  const evm = useEvmWallet();
  const [stage, setStage] = useState<RelayStage | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation<{ hash: string }, Error, DisburseInput>({
    mutationFn: async ({
      chainId,
      loanId,
      amountRaw,
      valueDate,
      reference,
    }) => {
      setStage(null);
      const wallet = pickChainWallet(chainId, stellar, evm);
      const blocked = loanActionChainReason(chainId);
      if (blocked) throw new Error(blocked);
      if (!disburseConfigured(chainId))
        throw new Error(DISBURSE_NOT_CONFIGURED);

      if (wallet.kind === "evm") {
        if (!wallet.isConnected || !wallet.address) {
          throw new Error("EVM wallet not connected.");
        }
        const evmRefHash = `0x${await bankReferenceRefHash(reference)}`;
        const evmSeen = await readEvmRefHashSeen({
          minter: ENV.EVM_MINTER_ADDRESS,
          refHash: evmRefHash,
        });
        if (evmSeen) throw new Error(REUSED_DISBURSE_REFERENCE);
        if (await readEvmMinterPaused({ minter: ENV.EVM_MINTER_ADDRESS })) {
          throw new Error(MINTER_PAUSED);
        }
        return disburseEvmLoan({
          accessManager: ENV.EVM_ACCESS_MANAGER_ADDRESS,
          minter: ENV.EVM_MINTER_ADDRESS,
          caller: wallet.address,
          chainId: ENV.EVM_CHAIN_ID,
          loanId,
          amountRaw,
          valueDate,
          refHash: evmRefHash,
          onStageChange: setStage,
        });
      }

      if (!stellar.isConnected || !stellar.address) {
        throw new Error("Stellar wallet not connected.");
      }
      const refHash = await bankReferenceRefHash(reference);
      const seen = await readRefHashSeen({
        minterId: ENV.STELLAR_YIELD_MINTER_ID,
        refHash,
        ...rpc(),
      });
      if (seen) throw new Error(REUSED_DISBURSE_REFERENCE);
      if (await fetchMinterPaused()) throw new Error(MINTER_PAUSED);
      return disburse({
        accessManagerId: ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID,
        minterId: ENV.STELLAR_YIELD_MINTER_ID,
        caller: stellar.address,
        loanId,
        amountRaw,
        valueDate,
        refHash,
        signTransaction: stellar.signTransaction,
        onStageChange: setStage,
        ...rpc(),
      });
    },
    onSuccess: () => {
      invalidateDisburse(queryClient);
      for (const delayMs of RECHECK_DELAYS_MS) {
        setTimeout(() => invalidateDisburse(queryClient), delayMs);
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
    isSuccess: mutation.isSuccess,
    error: mutation.error,
    stage,
    reset,
  };
}
