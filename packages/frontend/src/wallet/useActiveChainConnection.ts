// spec: docs/frontend/hooks.md
import { ENV } from "@/lib/env";
import { useEvmWallet } from "./evm/useEvmWallet";
import { useStellarWallet } from "./stellar/useStellarWallet";
import { useWalletView, type WalletViewKind } from "./WalletViewContext";

export interface UseActiveChainConnectionResult {
  kind: WalletViewKind;
  address: string | undefined;
  isConnected: boolean;
  chainId: number;
}

export function useActiveChainConnection(): UseActiveChainConnectionResult {
  const { kind } = useWalletView();
  const { address: evmAddress, isConnected: isEvmConnected } = useEvmWallet();
  const { address: stellarAddress, isConnected: isStellarConnected } =
    useStellarWallet();
  const isStellar = kind === "stellar";
  return {
    kind,
    address: isStellar ? stellarAddress : evmAddress,
    isConnected: isStellar ? isStellarConnected : isEvmConnected,
    chainId: isStellar ? ENV.STELLAR_CHAIN_ID : ENV.EVM_CHAIN_ID,
  };
}
