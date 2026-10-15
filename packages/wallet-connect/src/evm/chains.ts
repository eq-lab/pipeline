// spec: docs/frontend/wallet-flows.md#chain-registry
import { defineChain } from "@reown/appkit/networks";

export interface EvmChainInfo {
  id: number;
  name: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  explorer?: { name: string; url: string };
  testnet: boolean;
}

const ETHER = { name: "Ether", symbol: "ETH", decimals: 18 } as const;

const KNOWN_EVM_CHAINS: Readonly<Record<number, Omit<EvmChainInfo, "id">>> = {
  1: {
    name: "Ethereum",
    nativeCurrency: ETHER,
    explorer: { name: "Etherscan", url: "https://etherscan.io" },
    testnet: false,
  },
  560048: {
    name: "Hoodi",
    nativeCurrency: ETHER,
    explorer: { name: "Etherscan", url: "https://hoodi.etherscan.io" },
    testnet: true,
  },
};

export function isKnownEvmChain(chainId: number): boolean {
  return chainId in KNOWN_EVM_CHAINS;
}

export function evmChainInfo(chainId: number): EvmChainInfo {
  const known = KNOWN_EVM_CHAINS[chainId];
  if (known) return { id: chainId, ...known };
  return {
    id: chainId,
    name: `EVM chain ${chainId}`,
    nativeCurrency: ETHER,
    testnet: true,
  };
}

type AppKitEvmChain = ReturnType<typeof defineChain>;

const cache = new Map<string, AppKitEvmChain>();

export function defineEvmChain(
  chainId: number,
  rpcUrl: string,
): AppKitEvmChain {
  const key = `${chainId}|${rpcUrl}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const info = evmChainInfo(chainId);
  const chain = defineChain({
    id: chainId,
    caipNetworkId: `eip155:${chainId}` as `eip155:${number}`,
    chainNamespace: "eip155",
    name: info.name,
    nativeCurrency: info.nativeCurrency,
    rpcUrls: { default: { http: [rpcUrl] } },
    ...(info.explorer ? { blockExplorers: { default: info.explorer } } : {}),
    testnet: info.testnet,
  });
  cache.set(key, chain);
  return chain;
}

export function _resetEvmChainCacheForTests(): void {
  cache.clear();
}
