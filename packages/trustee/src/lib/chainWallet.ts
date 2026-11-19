// spec: docs/frontend/trustee-flows.md#risk-council-security-actions
import { useEvmWallet, useStellarWallet } from "@pipeline/wallet-connect";
import { isStellarTarget } from "@/lib/targetChains";

export interface ChainWallet {
  kind: "stellar" | "evm";
  address: string | undefined;
  isConnected: boolean;
}

export function pickChainWallet(
  chainId: number | null | undefined,
  stellar: { address: string | undefined; isConnected: boolean },
  evm: { address: string | undefined; isConnected: boolean },
): ChainWallet {
  return isStellarTarget(chainId)
    ? {
        kind: "stellar",
        address: stellar.address,
        isConnected: stellar.isConnected,
      }
    : { kind: "evm", address: evm.address, isConnected: evm.isConnected };
}

export function useChainWallet(
  chainId: number | null | undefined,
): ChainWallet {
  const stellar = useStellarWallet();
  const evm = useEvmWallet();
  return pickChainWallet(chainId, stellar, evm);
}
