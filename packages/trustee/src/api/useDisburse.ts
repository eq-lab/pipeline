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
  readCanCall,
  readDebtTrustline,
  readLoanDisbursementState,
  readLoanOwner,
  readRefHashSeen,
  useStellarWallet,
  type CanCall,
  type LoanDisbursementState,
  type RelayStage,
} from "@pipeline/wallet-connect";
import { ENV } from "@/lib/env";
import { stellarOnlyActionReason } from "@/lib/targetChains";
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
  "loan-valuation",
  "loan-waterfall",
  "cash-book",
  "deal-token",
  "debt-trustline",
  "audit-log",
];

export function disburseConfigured(): boolean {
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
      stellarOnlyActionReason(chainId) === null &&
      disburseConfigured() &&
      validLoanId(loanId),
    staleTime: 15_000,
    retry: false,
    queryFn: () =>
      readLoanDisbursementState({
        registryId: ENV.STELLAR_LOAN_REGISTRY_ID,
        loanId: loanId as number,
        ...rpc(),
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
    enabled: !!debt && disburseConfigured() && validLoanId(loanId),
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

export function useDisburseAccess(enabled: boolean) {
  const { address } = useStellarWallet();
  return useQuery<CanCall, Error>({
    queryKey: ["disburse-access", address],
    enabled: enabled && !!address && disburseConfigured(),
    staleTime: 30_000,
    retry: false,
    queryFn: () =>
      readCanCall({
        accessManagerId: ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID,
        caller: address!,
        target: ENV.STELLAR_YIELD_MINTER_ID,
        fn: "disburse",
        ...rpc(),
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
  const { address, isConnected, signTransaction } = useStellarWallet();
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
      const blocked = stellarOnlyActionReason(chainId);
      if (blocked) throw new Error(blocked);
      if (!disburseConfigured()) throw new Error(DISBURSE_NOT_CONFIGURED);
      if (!isConnected || !address) {
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
        caller: address,
        loanId,
        amountRaw,
        valueDate,
        refHash,
        signTransaction,
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
