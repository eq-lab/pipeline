// spec: docs/frontend/wallet-flows.md#active-chain-for-protocol-reads
import { ENV } from "@/lib/env";
import { useEvmWallet } from "./evm/useEvmWallet";
import { useStellarWallet } from "./stellar/useStellarWallet";
import { useWalletView, type WalletViewKind } from "./WalletViewContext";

export interface UseActiveChainResult {
  kind: WalletViewKind;
  chainId: number;
}

export function useActiveChain(): UseActiveChainResult {
  const { kind: viewKind } = useWalletView();
  const { isConnected: isEvmConnected } = useEvmWallet();
  const { isConnected: isStellarConnected } = useStellarWallet();

  let kind: WalletViewKind = "stellar";
  if (isEvmConnected && isStellarConnected) kind = viewKind;
  else if (isEvmConnected) kind = "evm";

  return {
    kind,
    chainId: kind === "evm" ? ENV.EVM_CHAIN_ID : ENV.STELLAR_CHAIN_ID,
  };
}
