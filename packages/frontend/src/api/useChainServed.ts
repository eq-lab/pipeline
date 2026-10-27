// spec: docs/frontend/wallet-flows.md#active-chain-for-protocol-reads (chain-served check via GET /v1/chains, #1605).
import { useQuery } from "@tanstack/react-query";
import { evmChainInfo, isKnownEvmChain } from "@pipeline/wallet-connect";
import { useActiveChain } from "@/wallet";
import { apiFetch } from "./client";

export interface ChainItem {
  chain_id: number;
  kind: "evm" | "stellar";
}

export interface ChainsResponse {
  chains: ChainItem[];
  default_chain_id: number;
}

export interface UseChainServedResult {
  kind: "evm" | "stellar";
  chainId: number;
  chainName: string;
  served: boolean | undefined;
}

export function chainDisplayName(
  kind: "evm" | "stellar",
  chainId: number,
): string {
  if (kind === "stellar") return "Stellar";
  return isKnownEvmChain(chainId)
    ? evmChainInfo(chainId).name
    : `chain ${chainId}`;
}

export function useChainServed(): UseChainServedResult {
  const { kind, chainId } = useActiveChain();
  const query = useQuery<ChainsResponse, Error>({
    queryKey: ["chains"],
    queryFn: () => apiFetch<ChainsResponse>("/v1/chains"),
    staleTime: Infinity,
    retry: false,
  });

  const served = query.isError
    ? true
    : query.data?.chains.some((c) => c.chain_id === chainId);

  return {
    kind,
    chainId,
    chainName: chainDisplayName(kind, chainId),
    served,
  };
}
