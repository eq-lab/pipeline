// spec: docs/frontend/wallet-flows.md#business-rules

import { useQuery } from "@tanstack/react-query";
import { rpc as SorobanRpc } from "@stellar/stellar-sdk";
import { callView } from "./useStellarDepositManagerAddresses";
import { depositManagerId, sorobanRpcUrl } from "./chain";

export interface UseStellarDepositManagerMinDepositResult {
  minDeposit: bigint | undefined;
  isLoading: boolean;
  error: Error | null;
}

async function fetchMinDeposit(contractId: string): Promise<bigint> {
  const server = new SorobanRpc.Server(sorobanRpcUrl, {
    allowHttp: sorobanRpcUrl.startsWith("http://"),
  });
  const value = await callView(server, contractId, "min_deposit");
  return BigInt(value as bigint | number | string);
}

export function useStellarDepositManagerMinDeposit(): UseStellarDepositManagerMinDepositResult {
  const isConfigured = !!depositManagerId;

  const query = useQuery({
    queryKey: ["stellarDepositManagerMinDeposit", depositManagerId],
    queryFn: () => fetchMinDeposit(depositManagerId),
    enabled: isConfigured,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });

  if (!isConfigured) {
    return { minDeposit: undefined, isLoading: false, error: null };
  }

  return {
    minDeposit: query.data,
    isLoading: query.isLoading,
    error: (query.error as Error | null) ?? null,
  };
}
