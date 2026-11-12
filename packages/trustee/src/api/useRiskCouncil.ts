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
  readCanCall,
  readLoanChainState,
  readLoanMoney,
  readRiskCouncilSchedule,
  relayRiskCouncil,
  useStellarWallet,
  type CanCall,
  type LoanChainState,
  type LoanMoney,
  type OperationSchedule,
  type RelayMode,
  type RelayStage,
  type RiskCouncilCall,
  type RiskCouncilClosureReason,
} from "@pipeline/wallet-connect";
import { ENV } from "@/lib/env";
import { stellarOnlyActionReason } from "@/lib/targetChains";
import {
  markExecuted,
  recordScheduledOp,
  riskCouncilCallKey,
  type ScheduledOp,
} from "@/lib/riskCouncilOps";
import type { LoanBookEntry } from "./useLoanBook";

export type { RelayStage, RiskCouncilCall, RiskCouncilClosureReason };

export interface RiskCouncilAccess {
  canCall: CanCall;
  schedule: OperationSchedule | null;
}

export interface RiskCouncilRelayInput {
  mode: RelayMode;
  call: RiskCouncilCall;
  chainId: number;
}

export interface RiskCouncilLoanState {
  chain: LoanChainState;
  money: LoanMoney;
}

export interface HubLookup {
  call: RiskCouncilCall;
  readyAt: number;
  pageLocal: ScheduledOp | undefined;
}

const NOT_CONFIGURED =
  "On-chain Risk Council actions are not configured for this environment.";

const SET_DEFAULT_STATUSES: ReadonlySet<string> = new Set([
  "Performing",
  "WatchList",
]);

function riskCouncilConfig() {
  const accessManagerId = ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID;
  const registryId = ENV.STELLAR_LOAN_REGISTRY_ID;
  if (!accessManagerId || !registryId) return null;
  return {
    accessManagerId,
    registryId,
    rpcUrl: ENV.STELLAR_RPC_URL,
    networkPassphrase: ENV.STELLAR_NETWORK_PASSPHRASE,
  };
}

export function useRiskCouncilAccess(
  chainId: number | null | undefined,
  call: RiskCouncilCall | null,
  fn: RiskCouncilCall["fn"],
) {
  const { address } = useStellarWallet();
  const callKey = call == null ? null : riskCouncilCallKey(call);

  return useQuery<RiskCouncilAccess, Error>({
    queryKey: ["risk-council-access", address, fn, callKey],
    enabled: stellarOnlyActionReason(chainId) === null && !!address,
    staleTime: 5_000,
    retry: false,
    queryFn: async () => {
      const cfg = riskCouncilConfig();
      if (!cfg) throw new Error(NOT_CONFIGURED);
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
        schedule = await readRiskCouncilSchedule({
          call,
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

  const mutation = useMutation<{ hash: string }, Error, RiskCouncilRelayInput>({
    mutationFn: async ({ mode, call, chainId }) => {
      setStage(null);
      const blocked = stellarOnlyActionReason(chainId);
      if (blocked) throw new Error(blocked);
      const cfg = riskCouncilConfig();
      if (!cfg) throw new Error(NOT_CONFIGURED);
      if (!isConnected || !address) {
        throw new Error("Stellar wallet not connected.");
      }
      return relayRiskCouncil({
        mode,
        call,
        accessManagerId: cfg.accessManagerId,
        registryId: cfg.registryId,
        caller: address,
        rpcUrl: cfg.rpcUrl,
        networkPassphrase: cfg.networkPassphrase,
        signTransaction,
        onStageChange: setStage,
      });
    },
    onSuccess: (_data, { mode, call, chainId }) => {
      if (mode === "schedule") recordScheduledOp({ chainId, call });
      else markExecuted(chainId, call);
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

export function hubCallsFor(
  loans: ReadonlyArray<Pick<LoanBookEntry, "loan_id" | "onchain_status">>,
  pageLocal: ReadonlyArray<ScheduledOp>,
): Array<{ call: RiskCouncilCall; pageLocal: ScheduledOp | undefined }> {
  const byKey = new Map<
    string,
    { call: RiskCouncilCall; pageLocal: ScheduledOp | undefined }
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
        const cfg = riskCouncilConfig();
        if (!cfg) throw new Error(NOT_CONFIGURED);
        if (!address) throw new Error("Stellar wallet not connected.");
        const schedule = await readRiskCouncilSchedule({
          call,
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
