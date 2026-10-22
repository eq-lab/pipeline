// spec: docs/frontend/wallet-flows.md#active-chain-for-protocol-reads (chain-served probe, #1605).
import { useQuery } from "@tanstack/react-query";
import { evmChainInfo, isKnownEvmChain } from "@pipeline/wallet-connect";
import { useActiveChain } from "@/wallet";
import { ApiError, apiFetch } from "./client";

const PROBE_WALLET = "0x0000000000000000000000000000000000000000";

export interface UseChainServedResult {
  kind: "evm" | "stellar";
  chainId: number;
  chainName: string;
  served: boolean | undefined;
}

export function isUnknownChainError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 400 &&
    /^unknown chain_id/i.test(error.message)
  );
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
  const query = useQuery<boolean, Error>({
    queryKey: ["chain-served", chainId],
    queryFn: async () => {
      try {
        await apiFetch<unknown>(
          `/v1/pnl?wallet=${PROBE_WALLET}&chain_id=${chainId}`,
        );
        return true;
      } catch (error) {
        return !isUnknownChainError(error);
      }
    },
    enabled: kind === "evm",
    staleTime: Infinity,
    retry: false,
  });

  return {
    kind,
    chainId,
    chainName: chainDisplayName(kind, chainId),
    served: kind === "stellar" ? true : query.data,
  };
}
