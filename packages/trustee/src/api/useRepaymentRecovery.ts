// spec: docs/frontend/trustee-flows.md#repayment-recovery-1711
import { useCallback, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  evmRepaySelector,
  evmReverseRepayRefHash,
  evmReverseRepaySelector,
  executeEvmReverseRepay,
  executeReverseRepay,
  readCanCall,
  readEvmCanCall,
  readEvmRecoveryRepayments,
  readEvmReverseRepaySchedule,
  readIsRepaymentReversed,
  readMinterRepayment,
  readNextRepaymentId,
  readRepaymentData,
  readReverseRepaySchedule,
  reverseRepayRefHash,
  scheduleEvmReverseRepay,
  scheduleReverseRepay,
  useEvmWallet,
  useStellarWallet,
  type CanCall,
  type MinterRepayment,
  type RepaymentInput,
  type OperationSchedule,
  type RelayStage,
} from "@pipeline/wallet-connect";
import { pickChainWallet, useChainWallet } from "@/lib/chainWallet";
import { ENV } from "@/lib/env";
import { markOperationExecuted } from "@/lib/riskCouncilOps";
import { isStellarTarget, riskCouncilChainReason } from "@/lib/targetChains";

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
  chainId: number;
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

function recoveryConfig(chainId: number) {
  if (!isStellarTarget(chainId)) {
    const accessManager = ENV.EVM_ACCESS_MANAGER_ADDRESS;
    const minter = ENV.EVM_MINTER_ADDRESS;
    const registry = ENV.EVM_LOAN_REGISTRY_ADDRESS;
    if (!accessManager || !minter || !registry) return null;
    return {
      kind: "evm" as const,
      accessManager,
      minter,
      registry,
      fromBlock: BigInt(ENV.EVM_START_BLOCK),
      chainId: ENV.EVM_CHAIN_ID,
    };
  }
  const accessManagerId = ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID;
  const minterId = ENV.STELLAR_YIELD_MINTER_ID;
  const registryId = ENV.STELLAR_LOAN_REGISTRY_ID;
  if (!accessManagerId || !minterId || !registryId) return null;
  return {
    kind: "stellar" as const,
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
    riskCouncilChainReason(chainId) === null &&
    onchainStatus != null &&
    RECOVERY_STATUSES.has(onchainStatus) &&
    loanId.length > 0;

  return useQuery<RecoveryCandidates, Error>({
    queryKey: ["repayment-recovery", chainId, loanId],
    enabled,
    staleTime: 15_000,
    retry: false,
    queryFn: async () => {
      const cfg = recoveryConfig(chainId);
      if (!cfg) throw new Error(NOT_CONFIGURED);
      const id = Number(loanId);
      if (cfg.kind === "evm") {
        const rows = await readEvmRecoveryRepayments({
          registry: cfg.registry,
          minter: cfg.minter,
          loanId: id,
          fromBlock: cfg.fromBlock,
          chainId: cfg.chainId,
        });
        return { rows, latestReversed: rows.at(-1)?.reversed === true };
      }
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
  chainId: number,
  loanId: number,
  repaymentId: number | null,
  enabled: boolean,
) {
  const { address } = useChainWallet(chainId);

  return useQuery<ReverseRepayAccess, Error>({
    queryKey: [
      "repayment-recovery-access",
      chainId,
      address,
      loanId,
      repaymentId,
    ],
    enabled:
      enabled &&
      riskCouncilChainReason(chainId) === null &&
      !!address &&
      repaymentId !== null,
    staleTime: 5_000,
    retry: false,
    queryFn: async () => {
      const cfg = recoveryConfig(chainId);
      if (!cfg) throw new Error(NOT_CONFIGURED);
      if (!address || repaymentId === null) {
        throw new Error(
          cfg.kind === "evm"
            ? "EVM wallet not connected."
            : "Stellar wallet not connected.",
        );
      }
      if (cfg.kind === "evm") {
        const callParams = {
          accessManager: cfg.accessManager,
          caller: address,
          target: cfg.minter,
        };
        const [canReverse, canRepay] = await Promise.all([
          readEvmCanCall({
            ...callParams,
            selector: evmReverseRepaySelector(),
          }),
          readEvmCanCall({ ...callParams, selector: evmRepaySelector() }),
        ]);
        let schedule: OperationSchedule | null = null;
        if (!canReverse.immediate && canReverse.delay > 0) {
          const refHash = await evmReverseRepayRefHash({
            minter: cfg.minter,
            loanId,
            repaymentId,
          });
          schedule = await readEvmReverseRepaySchedule({
            accessManager: cfg.accessManager,
            minter: cfg.minter,
            caller: address,
            loanId,
            repaymentId,
            refHash,
          });
        }
        return { canReverse, canRepay, schedule };
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
  const stellarWallet = useStellarWallet();
  const evmWallet = useEvmWallet();
  const { signTransaction } = stellarWallet;
  const [stage, setStage] = useState<RelayStage | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation<
    { hash: string; schedule?: OperationSchedule },
    Error,
    ReverseRepayInput
  >({
    mutationFn: async ({ loanId, repaymentId, chainId }) => {
      setStage(null);
      const cfg = recoveryConfig(chainId);
      if (!cfg) throw new Error(NOT_CONFIGURED);
      const { address, isConnected } = pickChainWallet(
        chainId,
        stellarWallet,
        evmWallet,
      );
      if (cfg.kind === "evm") {
        if (!isConnected || !address) {
          throw new Error("EVM wallet not connected.");
        }
        const refHash = await evmReverseRepayRefHash({
          minter: cfg.minter,
          loanId,
          repaymentId,
        });
        const params = {
          accessManager: cfg.accessManager,
          minter: cfg.minter,
          caller: address,
          loanId,
          repaymentId,
          refHash,
        };
        if (mode === "schedule") {
          return scheduleEvmReverseRepay({
            ...params,
            chainId: cfg.chainId,
            onStageChange: setStage,
          });
        }
        let schedule: OperationSchedule | undefined;
        try {
          schedule = await readEvmReverseRepaySchedule(params);
        } catch {
          schedule = undefined;
        }
        const { hash } = await executeEvmReverseRepay({
          ...params,
          chainId: cfg.chainId,
          onStageChange: setStage,
        });
        return { hash, schedule };
      }
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
      if (mode === "schedule") return scheduleReverseRepay(params);
      let schedule: OperationSchedule | undefined;
      try {
        schedule = await readReverseRepaySchedule(params);
      } catch {
        schedule = undefined;
      }
      const { hash } = await executeReverseRepay(params);
      return { hash, schedule };
    },
    onSuccess: ({ hash, schedule }, { chainId }) => {
      if (schedule?.operationId && schedule.readyAt > 0) {
        markOperationExecuted(
          chainId,
          schedule.operationId,
          hash,
          schedule.readyAt,
        );
      }
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
