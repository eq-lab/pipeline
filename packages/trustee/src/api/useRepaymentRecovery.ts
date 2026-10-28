// spec: docs/frontend/trustee-flows.md#repayment-recovery-1711
import { useCallback, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  executeReverseRepay,
  readCanCall,
  readIsRepaymentReversed,
  readMinterRepayment,
  readNextRepaymentId,
  readRepaymentData,
  readReverseRepaySchedule,
  reverseRepayRefHash,
  scheduleReverseRepay,
  useStellarWallet,
  type CanCall,
  type MinterRepayment,
  type RepaymentInput,
  type OperationSchedule,
  type RelayStage,
} from "@pipeline/wallet-connect";
import { ENV } from "@/lib/env";
import { stellarOnlyActionReason } from "@/lib/targetChains";

export type { RelayStage };

export const RECOVERY_STATUSES: ReadonlySet<string> = new Set([
  "Performing",
  "WatchList",
  "Default",
]);

export interface RecoveryRow {
  repaymentId: number;
  repayment: RepaymentInput;
  minter: MinterRepayment;
  reversed: boolean;
}

export interface RecoveryCandidates {
  rows: RecoveryRow[];
  latestReversed: boolean;
}

export interface ReverseRepayAccess {
  canReverse: CanCall;
  canRepay: CanCall;
  schedule: OperationSchedule | null;
}

export interface ReverseRepayInput {
  loanId: number;
  repaymentId: number;
}

export interface UseReverseRepayMutationResult {
  mutateAsync: (input: ReverseRepayInput) => Promise<{ hash: string }>;
  isPending: boolean;
  isSuccess: boolean;
  error: Error | null;
  stage: RelayStage | null;
  reset: () => void;
}

const NOT_CONFIGURED =
  "On-chain repayment recovery is not configured for this environment.";

function recoveryConfig() {
  const accessManagerId = ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID;
  const minterId = ENV.STELLAR_YIELD_MINTER_ID;
  const registryId = ENV.STELLAR_LOAN_REGISTRY_ID;
  if (!accessManagerId || !minterId || !registryId) return null;
  return {
    accessManagerId,
    minterId,
    registryId,
    rpcUrl: ENV.STELLAR_RPC_URL,
    networkPassphrase: ENV.STELLAR_NETWORK_PASSPHRASE,
  };
}

export function useRecoveryCandidates(
  chainId: number,
  loanId: string,
  onchainStatus: string | null | undefined,
) {
  const enabled =
    stellarOnlyActionReason(chainId) === null &&
    onchainStatus != null &&
    RECOVERY_STATUSES.has(onchainStatus) &&
    loanId.length > 0;

  return useQuery<RecoveryCandidates, Error>({
    queryKey: ["repayment-recovery", chainId, loanId],
    enabled,
    staleTime: 15_000,
    retry: false,
    queryFn: async () => {
      const cfg = recoveryConfig();
      if (!cfg) throw new Error(NOT_CONFIGURED);
      const id = Number(loanId);
      const base = {
        rpcUrl: cfg.rpcUrl,
        networkPassphrase: cfg.networkPassphrase,
      };
      const next = await readNextRepaymentId({
        registryId: cfg.registryId,
        loanId: id,
        ...base,
      });
      const rows = await Promise.all(
        Array.from({ length: next }, async (_, repaymentId) => {
          const [repayment, reversed, minter] = await Promise.all([
            readRepaymentData({
              registryId: cfg.registryId,
              loanId: id,
              repaymentId,
              ...base,
            }),
            readIsRepaymentReversed({
              registryId: cfg.registryId,
              loanId: id,
              repaymentId,
              ...base,
            }),
            readMinterRepayment({
              minterId: cfg.minterId,
              loanId: id,
              repaymentId,
              ...base,
            }),
          ]);
          return { repaymentId, repayment, minter, reversed };
        }),
      );
      return { rows, latestReversed: rows.at(-1)?.reversed === true };
    },
  });
}

export function useReverseRepayAccess(
  loanId: number,
  repaymentId: number | null,
  enabled: boolean,
) {
  const { address } = useStellarWallet();

  return useQuery<ReverseRepayAccess, Error>({
    queryKey: ["repayment-recovery-access", address, loanId, repaymentId],
    enabled: enabled && !!address && repaymentId !== null,
    staleTime: 5_000,
    retry: false,
    queryFn: async () => {
      const cfg = recoveryConfig();
      if (!cfg) throw new Error(NOT_CONFIGURED);
      if (!address || repaymentId === null) {
        throw new Error("Stellar wallet not connected.");
      }
      const base = {
        rpcUrl: cfg.rpcUrl,
        networkPassphrase: cfg.networkPassphrase,
      };
      const callParams = {
        accessManagerId: cfg.accessManagerId,
        caller: address,
        target: cfg.minterId,
        ...base,
      };
      const [canReverse, canRepay] = await Promise.all([
        readCanCall({ ...callParams, fn: "reverse_repay" }),
        readCanCall({ ...callParams, fn: "repay" }),
      ]);
      let schedule: OperationSchedule | null = null;
      if (!canReverse.immediate && canReverse.delay > 0) {
        const refHash = await reverseRepayRefHash({
          minterId: cfg.minterId,
          loanId,
          repaymentId,
        });
        schedule = await readReverseRepaySchedule({
          accessManagerId: cfg.accessManagerId,
          minterId: cfg.minterId,
          caller: address,
          loanId,
          repaymentId,
          refHash,
          ...base,
        });
      }
      return { canReverse, canRepay, schedule };
    },
  });
}

function invalidateRecovery(queryClient: QueryClient) {
  for (const key of [
    "repayment-recovery",
    "repayment-recovery-access",
    "loan-book",
    "loan-financials",
    "loan-waterfall",
    "audit-log",
  ]) {
    void queryClient.invalidateQueries({ queryKey: [key] });
  }
}

function useReverseRepayMutation(
  mode: "schedule" | "execute",
): UseReverseRepayMutationResult {
  const { address, isConnected, signTransaction } = useStellarWallet();
  const [stage, setStage] = useState<RelayStage | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation<{ hash: string }, Error, ReverseRepayInput>({
    mutationFn: async ({ loanId, repaymentId }) => {
      setStage(null);
      const cfg = recoveryConfig();
      if (!cfg) throw new Error(NOT_CONFIGURED);
      if (!isConnected || !address) {
        throw new Error("Stellar wallet not connected.");
      }
      const refHash = await reverseRepayRefHash({
        minterId: cfg.minterId,
        loanId,
        repaymentId,
      });
      const params = {
        accessManagerId: cfg.accessManagerId,
        minterId: cfg.minterId,
        caller: address,
        loanId,
        repaymentId,
        refHash,
        rpcUrl: cfg.rpcUrl,
        networkPassphrase: cfg.networkPassphrase,
        signTransaction,
        onStageChange: setStage,
      };
      return mode === "schedule"
        ? scheduleReverseRepay(params)
        : executeReverseRepay(params);
    },
    onSuccess: () => {
      invalidateRecovery(queryClient);
      for (const delayMs of [5_000, 15_000]) {
        setTimeout(() => invalidateRecovery(queryClient), delayMs);
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

export function useScheduleReverseRepay(): UseReverseRepayMutationResult {
  return useReverseRepayMutation("schedule");
}

export function useExecuteReverseRepay(): UseReverseRepayMutationResult {
  return useReverseRepayMutation("execute");
}
