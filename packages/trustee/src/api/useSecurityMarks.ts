// spec: docs/frontend/trustee-flows.md#security-marks-1859
import { useCallback, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  checkCoverage,
  readCanCall,
  relaySecurityRegistry,
  useStellarWallet,
  type CanCall,
  type RelayStage,
  type SecurityRegistryCall,
} from "@pipeline/wallet-connect";
import { ENV } from "@/lib/env";
import { stellarOnlyActionReason } from "@/lib/targetChains";
import { SECURITY_NOT_CONFIGURED } from "./useRiskCouncil";

export type { RelayStage };

export interface RevalueInput {
  chainId: number | null | undefined;
  recordId: number;
  valuePerUnit: string;
  benchmark: string;
  reportHash: string;
}

export interface ExtensionConsentInput {
  chainId: number | null | undefined;
  loanId: number;
  newMaturity: number;
  consentHash: string;
}

export interface CheckCoverageInput {
  chainId: number | null | undefined;
  loanId: number;
}

export interface WriteContext {
  caller: string;
  signTransaction: ReturnType<typeof useStellarWallet>["signTransaction"];
  onStageChange: (stage: RelayStage) => void;
}

const RECHECK_DELAYS_MS = [5_000, 15_000];
const INVALIDATED_KEYS = ["loan-security", "loan-book", "audit-log"];

export function securityMarksConfigured(): boolean {
  return (
    !!ENV.STELLAR_SECURITY_REGISTRY_ID &&
    !!ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID
  );
}

export function checkCoverageConfigured(): boolean {
  return !!ENV.STELLAR_SECURITY_REGISTRY_ID;
}

export function rpc() {
  return {
    rpcUrl: ENV.STELLAR_RPC_URL,
    networkPassphrase: ENV.STELLAR_NETWORK_PASSPHRASE,
  };
}

function invalidateSecurity(queryClient: QueryClient) {
  for (const key of INVALIDATED_KEYS) {
    void queryClient.invalidateQueries({ queryKey: [key] });
  }
}

export function useSecurityRegistryAccess(
  fn:
    | "revalue"
    | "record_extension_consent"
    | "record_inspection"
    | "approve_inspection",
  enabled: boolean,
) {
  const { address } = useStellarWallet();
  return useQuery<CanCall, Error>({
    queryKey: ["security-marks-access", address, fn],
    enabled: enabled && !!address && securityMarksConfigured(),
    staleTime: 30_000,
    retry: false,
    queryFn: () =>
      readCanCall({
        accessManagerId: ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID,
        caller: address!,
        target: ENV.STELLAR_SECURITY_REGISTRY_ID,
        fn,
        ...rpc(),
      }),
  });
}

export function useSecurityWrite<
  I extends { chainId: number | null | undefined },
  R extends { hash: string } = { hash: string },
>(configured: () => boolean, run: (input: I, ctx: WriteContext) => Promise<R>) {
  const { address, isConnected, signTransaction } = useStellarWallet();
  const [stage, setStage] = useState<RelayStage | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation<R, Error, I>({
    mutationFn: async (input) => {
      setStage(null);
      const blocked = stellarOnlyActionReason(input.chainId);
      if (blocked) throw new Error(blocked);
      if (!configured()) throw new Error(SECURITY_NOT_CONFIGURED);
      if (!isConnected || !address) {
        throw new Error("Stellar wallet not connected.");
      }
      return run(input, {
        caller: address,
        signTransaction,
        onStageChange: setStage,
      });
    },
    onSuccess: () => {
      invalidateSecurity(queryClient);
      for (const delayMs of RECHECK_DELAYS_MS) {
        setTimeout(() => invalidateSecurity(queryClient), delayMs);
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

function relayExecute(call: SecurityRegistryCall, ctx: WriteContext) {
  return relaySecurityRegistry({
    mode: "execute",
    call,
    accessManagerId: ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID,
    registryId: ENV.STELLAR_SECURITY_REGISTRY_ID,
    caller: ctx.caller,
    signTransaction: ctx.signTransaction,
    onStageChange: ctx.onStageChange,
    ...rpc(),
  });
}

export function useRevalue() {
  return useSecurityWrite<RevalueInput>(securityMarksConfigured, (input, ctx) =>
    relayExecute(
      {
        fn: "revalue",
        recordId: input.recordId,
        valuePerUnit: input.valuePerUnit,
        benchmark: input.benchmark,
        reportHash: input.reportHash,
      },
      ctx,
    ),
  );
}

export function useRecordExtensionConsent() {
  return useSecurityWrite<ExtensionConsentInput>(
    securityMarksConfigured,
    (input, ctx) =>
      relayExecute(
        {
          fn: "record_extension_consent",
          loanId: input.loanId,
          newMaturity: input.newMaturity,
          consentHash: input.consentHash,
        },
        ctx,
      ),
  );
}

export function useCheckCoverage() {
  return useSecurityWrite<CheckCoverageInput>(
    checkCoverageConfigured,
    (input, ctx) =>
      checkCoverage({
        registryId: ENV.STELLAR_SECURITY_REGISTRY_ID,
        loanId: input.loanId,
        caller: ctx.caller,
        signTransaction: ctx.signTransaction,
        onStageChange: ctx.onStageChange,
        ...rpc(),
      }),
  );
}
