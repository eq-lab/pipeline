// spec: docs/frontend/wallet-flows.md#chain-registry
import { getWalletConnectConfig } from "../config";
import { defineEvmChain, _resetEvmChainCacheForTests } from "./chains";

export function getEvmChain() {
  const config = getWalletConnectConfig();
  return defineEvmChain(config.evmChainId, config.evmRpcUrl);
}

export function _resetEvmChainForTests(): void {
  _resetEvmChainCacheForTests();
}
