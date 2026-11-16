// spec: docs/frontend/trustee-flows.md#risk-council-actions
import { useCallback, useState } from "react";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  executeScheduledOperation,
  readCanCall,
  readLoanChainState,
  readLoanMoney,
  readRiskCouncilSchedule,
  readSecurityInspectors,
  readScheduledOperation,
  readSecurityRegistrySchedule,
  relayRiskCouncil,
  relaySecurityRegistry,
  securityRegistryArgsXdr,
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
import { otherWalletCopy } from "@/lib/accessManagerAction";
import { ENV } from "@/lib/env";
import { stellarOnlyActionReason } from "@/lib/targetChains";
import {
  councilTarget,
  markExecuted,
  markOperationExecuted,
  recordScheduledOp,
  riskCouncilCallKey,
  type CouncilCall,
  type CouncilTarget,
  type ScheduledOp,
} from "@/lib/riskCouncilOps";
import type { LoanBookEntry } from "./useLoanBook";

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

export interface PendingOperationExecuteInput {
  chainId: number;
  operationId: string;
  caller: string;
  target: string;
  fn: string;
  argsXdr: string;
}

interface RelayOutcome {
  hash: string;
  schedule?: OperationSchedule;
  caller?: string;
  target?: string;
  argsXdr?: string;
}

export interface RiskCouncilLoanState {
  chain: LoanChainState;
  money: LoanMoney;
}

export interface HubLookup {
  call: CouncilCall;
  readyAt: number;
  pageLocal: ScheduledOp | undefined;
}

const NOT_CONFIGURED =
  "On-chain Risk Council actions are not configured for this environment.";
export const SECURITY_NOT_CONFIGURED =
  "On-chain SecurityRegistry actions are not configured for this environment.";

const SET_DEFAULT_STATUSES: ReadonlySet<string> = new Set([
  "Performing",
  "WatchList",
]);

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
  const { address } = useStellarWallet();
  const callKey = call == null ? null : riskCouncilCallKey(call);
  const target = councilTarget(fn);

  return useQuery<RiskCouncilAccess, Error>({
    queryKey: ["risk-council-access", address, target, fn, callKey],
    enabled: stellarOnlyActionReason(chainId) === null && !!address,
    staleTime: 5_000,
    retry: false,
    queryFn: async () => {
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

function invalidateRiskCouncil(queryClient: QueryClient) {
  for (const key of [
    "risk-council-access",
    "risk-council-loan",
    "risk-council-hub",
    "risk-council-inspectors",
    "loan-book",
    "loan-financials",
    "loan-security",
    "audit-log",
  ]) {
    void queryClient.invalidateQueries({ queryKey: [key] });
  }
}

export function useRiskCouncilRelay() {
  const { address, isConnected, signTransaction } = useStellarWallet();
  const [stage, setStage] = useState<RelayStage | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation<RelayOutcome, Error, RiskCouncilRelayInput>({
    mutationFn: async ({ mode, call, chainId }) => {
      setStage(null);
      const blocked = stellarOnlyActionReason(chainId);
      if (blocked) throw new Error(blocked);
      const target = councilTarget(call);
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
      if (mode !== "schedule") return { hash };
      let schedule: OperationSchedule | undefined;
      try {
        schedule = await readScheduleFor(call, {
          accessManagerId: cfg.accessManagerId,
          registryId: cfg.registryId,
          caller: address,
          rpcUrl: cfg.rpcUrl,
          networkPassphrase: cfg.networkPassphrase,
        });
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
            : undefined,
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
        });
      } else markExecuted(chainId, call);
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
  const { address, isConnected, signTransaction } = useStellarWallet();
  const [stage, setStage] = useState<RelayStage | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation<
    { hash: string },
    Error,
    PendingOperationExecuteInput
  >({
    mutationFn: async ({
      chainId,
      operationId,
      caller,
      target,
      fn,
      argsXdr,
    }) => {
      setStage(null);
      const blocked = stellarOnlyActionReason(chainId);
      if (blocked) throw new Error(blocked);
      const accessManagerId = ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID;
      if (!accessManagerId) throw new Error(NOT_CONFIGURED);
      if (!isConnected || !address) {
        throw new Error("Stellar wallet not connected.");
      }
      if (address !== caller) throw new Error(otherWalletCopy(caller));
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
      return executeScheduledOperation({
        accessManagerId,
        caller,
        target,
        fn,
        argsXdr,
        ...chain,
        signTransaction,
        onStageChange: setStage,
      });
    },
    onSuccess: (_data, { chainId, operationId }) => {
      markOperationExecuted(chainId, operationId);
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
    error: mutation.error,
    hash: mutation.data?.hash ?? null,
    stage,
    reset,
  };
}

export function hubCallsFor(
  loans: ReadonlyArray<Pick<LoanBookEntry, "loan_id" | "onchain_status">>,
  pageLocal: ReadonlyArray<ScheduledOp>,
): Array<{ call: CouncilCall; pageLocal: ScheduledOp | undefined }> {
  const byKey = new Map<
    string,
    { call: CouncilCall; pageLocal: ScheduledOp | undefined }
  >();
  for (const loan of loans) {
    const loanId = Number(loan.loan_id);
    if (!Number.isInteger(loanId)) continue;
    const fn = SET_DEFAULT_STATUSES.has(loan.onchain_status)
      ? "set_default"
      : loan.onchain_status === "Default"
        ? "cure"
        : null;
    if (fn == null) continue;
    const call: RiskCouncilCall = { fn, loanId };
    byKey.set(riskCouncilCallKey(call), { call, pageLocal: undefined });
  }
  for (const op of pageLocal) {
    byKey.set(riskCouncilCallKey(op.call), { call: op.call, pageLocal: op });
  }
  return Array.from(byKey.values());
}

export function useRiskCouncilHubLookups(
  chainId: number | null | undefined,
  loans: ReadonlyArray<Pick<LoanBookEntry, "loan_id" | "onchain_status">>,
  pageLocal: ReadonlyArray<ScheduledOp>,
  enabled: boolean,
) {
  const { address } = useStellarWallet();
  const calls = hubCallsFor(loans, pageLocal);
  const active =
    enabled && !!address && stellarOnlyActionReason(chainId) === null;

  return useQueries({
    queries: calls.map(({ call }) => ({
      queryKey: [
        "risk-council-hub",
        address,
        chainId,
        riskCouncilCallKey(call),
      ],
      enabled: active,
      staleTime: 30_000,
      retry: false,
      queryFn: async (): Promise<number> => {
        const target = councilTarget(call);
        const cfg = riskCouncilConfig(target);
        if (!cfg) throw new Error(notConfiguredFor(target));
        if (!address) throw new Error("Stellar wallet not connected.");
        const schedule = await readScheduleFor(call, {
          accessManagerId: cfg.accessManagerId,
          registryId: cfg.registryId,
          caller: address,
          rpcUrl: cfg.rpcUrl,
          networkPassphrase: cfg.networkPassphrase,
        });
        return schedule.readyAt;
      },
    })),
    combine: (results) => ({
      lookups: results.map<HubLookup | null>((result, index) =>
        result.data === undefined
          ? null
          : {
              call: calls[index]!.call,
              readyAt: result.data,
              pageLocal: calls[index]!.pageLocal,
            },
      ),
      isLoading: results.some((result) => result.isLoading),
    }),
  });
}

export function useSecurityInspectors(chainId: number | null | undefined) {
  return useQuery<string[], Error>({
    queryKey: ["risk-council-inspectors", chainId],
    enabled: stellarOnlyActionReason(chainId) === null,
    staleTime: 15_000,
    retry: false,
    queryFn: async () => {
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
