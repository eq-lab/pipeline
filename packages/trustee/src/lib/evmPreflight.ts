// spec: docs/frontend/trustee-flows.md#evm-1574
import type { ChainWallet } from "@/lib/chainWallet";
import { ENV } from "@/lib/env";
import { loanActionChainReason } from "@/lib/targetChains";

export const EVM_WALLET_NOT_CONNECTED = "EVM wallet not connected.";

export interface EvmPreflightInput<T> {
  chainId: number | null | undefined;
  wallet: ChainWallet;
  config: T | null | false;
  notConfigured: string;
  chainReason?: (chainId: number | null | undefined) => string | null;
}

export interface EvmPreflight<T> {
  config: T;
  caller: string;
  chainId: number;
}

export function evmPreflight<T>({
  chainId,
  wallet,
  config,
  notConfigured,
  chainReason = loanActionChainReason,
}: EvmPreflightInput<T>): EvmPreflight<T> {
  const blocked = chainReason(chainId);
  if (blocked) throw new Error(blocked);
  if (!config) throw new Error(notConfigured);
  if (!wallet.isConnected || !wallet.address) {
    throw new Error(EVM_WALLET_NOT_CONNECTED);
  }
  return { config, caller: wallet.address, chainId: ENV.EVM_CHAIN_ID };
}

export function evmLoanRegistryConfig(): {
  accessManager: string;
  registry: string;
} | null {
  const accessManager = ENV.EVM_ACCESS_MANAGER_ADDRESS;
  const registry = ENV.EVM_LOAN_REGISTRY_ADDRESS;
  return accessManager && registry ? { accessManager, registry } : null;
}
