// spec: docs/frontend/wallet-flows.md#wallet-namespace-labels
import { evmChainInfo, isKnownEvmChain } from "./evm/chains";

export type WalletNamespaceKind = "evm" | "stellar" | "soroban";

export function namespaceLabel(
  kind: WalletNamespaceKind,
  chainId?: number,
): string {
  if (kind !== "evm") return "Stellar";
  return chainId !== undefined && isKnownEvmChain(chainId)
    ? evmChainInfo(chainId).name
    : "Ethereum";
}
