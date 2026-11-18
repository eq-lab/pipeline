// spec: docs/frontend/trustee-flows.md#risk-council-actions
import { useCallback, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  encodeEvmSecurityRegistryCalldata,
  evmSecurityErrorAbi,
  evmSecuritySelector,
  evmSecurityTarget,
  executeEvmScheduledOperation,
  executeScheduledOperation,
  readCanCall,
  readEvmCanCall,
  readEvmScheduledOperation,
  readEvmSecurityInspectors,
  readEvmSecurityRegistrySchedule,
  readLoanChainState,
  readLoanMoney,
  readRiskCouncilSchedule,
  readSecurityInspectors,
  readScheduledOperation,
  readSecurityRegistrySchedule,
  relayRiskCouncil,
  relayEvmSecurityRegistry,
  relaySecurityRegistry,
  riskCouncilArgsXdr,
  securityRegistryArgsXdr,
  useEvmWallet,
  useStellarWallet,
  type CanCall,
  type LoanChainState,
  type LoanMoney,
  type OperationSchedule,
  type RelayMode,
  type RelayStage,
  type RiskCouncilCall,
  type RiskCouncilClosureReason,
  type SecurityRegistryCall,
} from "@pipeline/wallet-connect";
import type { PendingTargetKind } from "@/api/pendingOperations";
import { otherWalletCopy } from "@/lib/accessManagerAction";
import { pickChainWallet, useChainWallet } from "@/lib/chainWallet";
import { ENV } from "@/lib/env";
import {
  isStellarTarget,
  pendingRowBlockedReason,
  riskCouncilBlockedReason,
  sameChainAddress,
  stellarOnlyActionReason,
} from "@/lib/targetChains";
import {
  councilTarget,
  markExecuted,
  markOperationExecuted,
  recordScheduledOp,
  riskCouncilCallKey,
  type CouncilCall,
  type CouncilTarget,
} from "@/lib/riskCouncilOps";

export type {
  CouncilCall,
  RelayStage,
  RiskCouncilCall,
  RiskCouncilClosureReason,
  SecurityRegistryCall,
};

export interface RiskCouncilAccess {
  canCall: CanCall;
  schedule: OperationSchedule | null;
}

export interface RiskCouncilRelayInput {
  mode: RelayMode;
  call: CouncilCall;
  chainId: number;
  loanId?: number;
}

export class PendingArgsMismatchError extends Error {
  constructor() {
    super("The served arguments do not match the scheduled operation.");
    this.name = "PendingArgsMismatchError";
  }
}

export class NoLongerScheduledError extends Error {
  constructor() {
    super("The operation is no longer scheduled.");
    this.name = "NoLongerScheduledError";
  }
}

export class PendingTargetMismatchError extends Error {
  readonly target: string;
  constructor(target: string) {
    super("The operation targets another registry than this console.");
    this.name = "PendingTargetMismatchError";
    this.target = target;
  }
}

export class RegistryPausedError extends Error {
  constructor() {
    super("The registry is paused. Executing is blocked until it resumes.");
    this.name = "RegistryPausedError";
  }
}

export interface PendingOperationExecuteInput {
  chainId: number;
  operationId: string;
  caller: string;
  target: string;
  expectedTarget: string;
  paused: boolean;
  fn: string;
  argsXdr: string | null;
  calldata: string | null;
  targetKind: PendingTargetKind;
}

interface RelayOutcome {
  hash: string;
  schedule?: OperationSchedule;
  caller?: string;
  target?: string;
  argsXdr?: string;
  calldata?: string;
}

export interface RiskCouncilLoanState {
  chain: LoanChainState;
  money: LoanMoney;
}

const NOT_CONFIGURED =
  "On-chain Risk Council actions are not configured for this environment.";
export const SECURITY_NOT_CONFIGURED =
  "On-chain SecurityRegistry actions are not configured for this environment.";

function chainConfig() {
  return {
    rpcUrl: ENV.STELLAR_RPC_URL,
    networkPassphrase: ENV.STELLAR_NETWORK_PASSPHRASE,
  };
}

function riskCouncilConfig(target: CouncilTarget = "loan_registry") {
  const accessManagerId = ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID;
  const registryId =
    target === "security_registry"
      ? ENV.STELLAR_SECURITY_REGISTRY_ID
      : ENV.STELLAR_LOAN_REGISTRY_ID;
  if (!accessManagerId || !registryId) return null;
  return { accessManagerId, registryId, ...chainConfig() };
}

function evmCouncilConfig(fn: SecurityRegistryCall["fn"]) {
  const accessManager = ENV.EVM_ACCESS_MANAGER_ADDRESS;
  const registry = ENV.EVM_SECURITY_REGISTRY_ADDRESS;
  const recordNft = ENV.EVM_SECURITY_RECORD_NFT_ADDRESS;
  if (!accessManager || !registry || !recordNft) return null;
  return {
    accessManager,
    registry,
    recordNft,
    target: evmSecurityTarget(fn, { registry, recordNft }),
    chainId: ENV.EVM_CHAIN_ID,
  };
}

function notConfiguredFor(target: CouncilTarget): string {
  return target === "security_registry"
    ? SECURITY_NOT_CONFIGURED
    : NOT_CONFIGURED;
}

function readScheduleFor(
  call: CouncilCall,
  params: {
    accessManagerId: string;
    registryId: string;
    caller: string;
    rpcUrl: string;
    networkPassphrase: string;
  },
): Promise<OperationSchedule> {
  return councilTarget(call) === "security_registry"
    ? readSecurityRegistrySchedule({
        call: call as SecurityRegistryCall,
        ...params,
      })
    : readRiskCouncilSchedule({ call: call as RiskCouncilCall, ...params });
}

export function useRiskCouncilAccess(
  chainId: number | null | undefined,
  call: CouncilCall | null,
  fn: CouncilCall["fn"],
) {
  const { address } = useChainWallet(chainId);
  const callKey = call == null ? null : riskCouncilCallKey(call);
  const target = councilTarget(fn);

  return useQuery<RiskCouncilAccess, Error>({
    queryKey: ["risk-council-access", chainId, address, target, fn, callKey],
    enabled: riskCouncilBlockedReason(chainId, fn) === null && !!address,
    staleTime: 5_000,
    retry: false,
    queryFn: async () => {
      if (!isStellarTarget(chainId)) {
        const evmFn = fn as SecurityRegistryCall["fn"];
        const evm = evmCouncilConfig(evmFn);
        if (!evm) throw new Error(SECURITY_NOT_CONFIGURED);
        if (!address) throw new Error("EVM wallet not connected.");
        const canCall = await readEvmCanCall({
          accessManager: evm.accessManager,
          caller: address,
          target: evm.target,
          selector: evmSecuritySelector(evmFn),
        });
        let schedule: OperationSchedule | null = null;
        if (!canCall.immediate && canCall.delay > 0 && call !== null) {
          schedule = await readEvmSecurityRegistrySchedule({
            call: call as SecurityRegistryCall,
            accessManager: evm.accessManager,
            registry: evm.registry,
            recordNft: evm.recordNft,
            caller: address,
          });
        }
        return { canCall, schedule };
      }
      const cfg = riskCouncilConfig(target);
      if (!cfg) throw new Error(notConfiguredFor(target));
      if (!address) throw new Error("Stellar wallet not connected.");
      const base = {
        rpcUrl: cfg.rpcUrl,
        networkPassphrase: cfg.networkPassphrase,
      };
      const canCall = await readCanCall({
        accessManagerId: cfg.accessManagerId,
        caller: address,
        target: cfg.registryId,
        fn,
        ...base,
      });
      let schedule: OperationSchedule | null = null;
      if (!canCall.immediate && canCall.delay > 0 && call !== null) {
        schedule = await readScheduleFor(call, {
          accessManagerId: cfg.accessManagerId,
          registryId: cfg.registryId,
          caller: address,
          ...base,
        });
      }
      return { canCall, schedule };
    },
  });
}

export function useRiskCouncilLoanState(
  chainId: number | null | undefined,
  loanId: number | null,
) {
  return useQuery<RiskCouncilLoanState, Error>({
    queryKey: ["risk-council-loan", chainId, loanId],
    enabled:
      stellarOnlyActionReason(chainId) === null &&
      loanId !== null &&
      Number.isInteger(loanId),
    staleTime: 15_000,
    retry: false,
    queryFn: async () => {
      const cfg = riskCouncilConfig();
      if (!cfg) throw new Error(NOT_CONFIGURED);
      const params = {
        registryId: cfg.registryId,
        loanId: loanId as number,
        rpcUrl: cfg.rpcUrl,
        networkPassphrase: cfg.networkPassphrase,
      };
      const [chain, money] = await Promise.all([
        readLoanChainState(params),
        readLoanMoney(params),
      ]);
      return { chain, money };
    },
  });
}

const RISK_COUNCIL_KEYS = [
  "risk-council-access",
  "risk-council-loan",
  "risk-council-inspectors",
  "loan-book",
  "loan-financials",
  "loan-security",
  "audit-log",
];

const MINTER_KEYS = [
  "repayment-recovery",
  "repayment-recovery-access",
  "loan-waterfall",
];

function invalidateKeys(queryClient: QueryClient, keys: ReadonlyArray<string>) {
  for (const key of keys) {
    void queryClient.invalidateQueries({ queryKey: [key] });
  }
}

function invalidateRiskCouncil(queryClient: QueryClient) {
  invalidateKeys(queryClient, RISK_COUNCIL_KEYS);
}

function invalidatePendingExecute(queryClient: QueryClient) {
  invalidateKeys(queryClient, [...RISK_COUNCIL_KEYS, ...MINTER_KEYS]);
}

export function useRiskCouncilRelay() {
  const stellarWallet = useStellarWallet();
  const evmWallet = useEvmWallet();
  const { signTransaction } = stellarWallet;
  const [stage, setStage] = useState<RelayStage | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation<RelayOutcome, Error, RiskCouncilRelayInput>({
    mutationFn: async ({ mode, call, chainId }) => {
      setStage(null);
      const blocked = riskCouncilBlockedReason(chainId, call.fn);
      if (blocked) throw new Error(blocked);
      const wallet = pickChainWallet(chainId, stellarWallet, evmWallet);
      const { address, isConnected } = wallet;
      const target = councilTarget(call);
      if (wallet.kind === "evm") {
        const securityCall = call as SecurityRegistryCall;
        const evm = evmCouncilConfig(securityCall.fn);
        if (!evm) throw new Error(SECURITY_NOT_CONFIGURED);
        if (!isConnected || !address) {
          throw new Error("EVM wallet not connected.");
        }
        const scheduleParams = {
          call: securityCall,
          accessManager: evm.accessManager,
          registry: evm.registry,
          recordNft: evm.recordNft,
          caller: address,
        };
        let executing: OperationSchedule | undefined;
        if (mode === "execute") {
          try {
            executing = await readEvmSecurityRegistrySchedule(scheduleParams);
          } catch {
            executing = undefined;
          }
        }
        const { hash } = await relayEvmSecurityRegistry({
          ...scheduleParams,
          mode,
          chainId: evm.chainId,
          onStageChange: setStage,
        });
        if (mode !== "schedule") return { hash, schedule: executing };
        let schedule: OperationSchedule | undefined;
        try {
          schedule = await readEvmSecurityRegistrySchedule(scheduleParams);
        } catch {
          schedule = undefined;
        }
        return {
          hash,
          schedule,
          caller: address,
          target: evm.target,
          calldata: encodeEvmSecurityRegistryCalldata(securityCall),
        };
      }
      const cfg = riskCouncilConfig(target);
      if (!cfg) throw new Error(notConfiguredFor(target));
      if (!isConnected || !address) {
        throw new Error("Stellar wallet not connected.");
      }
      const params = {
        mode,
        accessManagerId: cfg.accessManagerId,
        registryId: cfg.registryId,
        caller: address,
        rpcUrl: cfg.rpcUrl,
        networkPassphrase: cfg.networkPassphrase,
        signTransaction,
        onStageChange: setStage,
      };
      const scheduleParams = {
        accessManagerId: cfg.accessManagerId,
        registryId: cfg.registryId,
        caller: address,
        rpcUrl: cfg.rpcUrl,
        networkPassphrase: cfg.networkPassphrase,
      };
      let executing: OperationSchedule | undefined;
      if (mode === "execute") {
        try {
          executing = await readScheduleFor(call, scheduleParams);
        } catch {
          executing = undefined;
        }
      }
      const { hash } =
        target === "security_registry"
          ? await relaySecurityRegistry({
              ...params,
              call: call as SecurityRegistryCall,
            })
          : await relayRiskCouncil({
              ...params,
              call: call as RiskCouncilCall,
            });
      if (mode !== "schedule") return { hash, schedule: executing };
      let schedule: OperationSchedule | undefined;
      try {
        schedule = await readScheduleFor(call, scheduleParams);
      } catch {
        schedule = undefined;
      }
      return {
        hash,
        schedule,
        caller: address,
        target: cfg.registryId,
        argsXdr:
          target === "security_registry"
            ? securityRegistryArgsXdr(call as SecurityRegistryCall)
            : riskCouncilArgsXdr(call as RiskCouncilCall),
      };
    },
    onSuccess: (data, { mode, call, chainId, loanId }) => {
      if (mode === "schedule") {
        recordScheduledOp({
          chainId,
          call,
          loanId,
          operationId: data.schedule?.operationId,
          readyAt: data.schedule?.readyAt,
          caller: data.caller,
          target: data.target,
          argsXdr: data.argsXdr,
          calldata: data.calldata,
        });
      } else {
        markExecuted(chainId, call, data.hash);
        if (data.schedule?.operationId && data.schedule.readyAt > 0) {
          markOperationExecuted(
            chainId,
            data.schedule.operationId,
            data.hash,
            data.schedule.readyAt,
          );
        }
      }
      invalidateRiskCouncil(queryClient);
      for (const delayMs of [5_000, 15_000]) {
        setTimeout(() => invalidateRiskCouncil(queryClient), delayMs);
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
    hash: mutation.data?.hash ?? null,
    stage,
    reset,
  };
}

export function usePendingOperationExecute() {
  const stellarWallet = useStellarWallet();
  const evmWallet = useEvmWallet();
  const { signTransaction } = stellarWallet;
  const [stage, setStage] = useState<RelayStage | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation<
    { hash: string; readyAt: number },
    Error,
    PendingOperationExecuteInput
  >({
    mutationFn: async ({
      chainId,
      operationId,
      caller,
      target,
      expectedTarget,
      paused,
      fn,
      argsXdr,
      calldata,
      targetKind,
    }) => {
      setStage(null);
      const blocked = pendingRowBlockedReason(chainId, targetKind);
      if (blocked) throw new Error(blocked);
      if (!sameChainAddress(chainId, target, expectedTarget)) {
        throw new PendingTargetMismatchError(target);
      }
      if (paused) throw new RegistryPausedError();
      const wallet = pickChainWallet(chainId, stellarWallet, evmWallet);
      const { address, isConnected } = wallet;
      if (wallet.kind === "evm") {
        const accessManager = ENV.EVM_ACCESS_MANAGER_ADDRESS;
        if (!accessManager) throw new Error(NOT_CONFIGURED);
        if (!isConnected || !address) {
          throw new Error("EVM wallet not connected.");
        }
        if (!sameChainAddress(chainId, address, caller)) {
          throw new Error(otherWalletCopy(caller));
        }
        if (calldata == null) throw new PendingArgsMismatchError();
        const evmBase = { accessManager, caller, target, calldata };
        const schedule = await readEvmScheduledOperation(evmBase);
        if (schedule.operationId !== operationId.toLowerCase()) {
          throw new PendingArgsMismatchError();
        }
        if (schedule.readyAt === 0) throw new NoLongerScheduledError();
        const { hash } = await executeEvmScheduledOperation({
          ...evmBase,
          chainId: ENV.EVM_CHAIN_ID,
          errorAbi: evmSecurityErrorAbi,
          onStageChange: setStage,
        });
        return { hash, readyAt: schedule.readyAt };
      }
      const accessManagerId = ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID;
      if (!accessManagerId) throw new Error(NOT_CONFIGURED);
      if (!isConnected || !address) {
        throw new Error("Stellar wallet not connected.");
      }
      if (address !== caller) throw new Error(otherWalletCopy(caller));
      if (argsXdr == null) throw new PendingArgsMismatchError();
      const chain = chainConfig();
      const schedule = await readScheduledOperation({
        accessManagerId,
        caller,
        target,
        fn,
        argsXdr,
        ...chain,
      });
      if (schedule.operationId !== operationId) {
        throw new PendingArgsMismatchError();
      }
      if (schedule.readyAt === 0) throw new NoLongerScheduledError();
      const { hash } = await executeScheduledOperation({
        accessManagerId,
        caller,
        target,
        fn,
        argsXdr,
        ...chain,
        signTransaction,
        onStageChange: setStage,
      });
      return { hash, readyAt: schedule.readyAt };
    },
    onSuccess: ({ hash, readyAt }, { chainId, operationId }) => {
      markOperationExecuted(chainId, operationId, hash, readyAt);
      invalidatePendingExecute(queryClient);
      for (const delayMs of [5_000, 15_000]) {
        setTimeout(() => invalidatePendingExecute(queryClient), delayMs);
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
    hash: mutation.data?.hash ?? null,
    stage,
    reset,
  };
}

export function useSecurityInspectors(chainId: number | null | undefined) {
  return useQuery<string[], Error>({
    queryKey: ["risk-council-inspectors", chainId],
    enabled: riskCouncilBlockedReason(chainId, "set_inspectors") === null,
    staleTime: 15_000,
    retry: false,
    queryFn: async () => {
      if (!isStellarTarget(chainId)) {
        const recordNft = ENV.EVM_SECURITY_RECORD_NFT_ADDRESS;
        if (!recordNft) throw new Error(SECURITY_NOT_CONFIGURED);
        return readEvmSecurityInspectors({ recordNft });
      }
      const cfg = riskCouncilConfig("security_registry");
      if (!cfg) throw new Error(SECURITY_NOT_CONFIGURED);
      return readSecurityInspectors({
        registryId: cfg.registryId,
        rpcUrl: cfg.rpcUrl,
        networkPassphrase: cfg.networkPassphrase,
      });
    },
  });
}
