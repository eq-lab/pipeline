import { defineChain } from "@reown/appkit/networks";
import { getWalletConnectConfig } from "../config";

type HoodiChain = ReturnType<typeof defineChain>;

/**
 * Hoodi testnet chain definition compatible with `@reown/appkit/networks`.
 *
 * Ported from `packages/frontend/src/wallet/evm/chain.ts` (#791 shared-slice
 * extraction). Hoodi is not in the AppKit network catalogue so it is defined
 * manually. Chain identifiers and explorer URL come from:
 * https://github.com/eth-clients/hoodi
 *
 * **Lazy by construction.** `getHoodiChain()` reads `getWalletConnectConfig()`
 * — which is undefined until the consuming app calls `setWalletConnectConfig()`
 * at bootstrap — so this must NOT be evaluated at module scope. ES module
 * imports are hoisted and evaluated before the importing module's own body
 * runs, so a module-scope `export const hoodi = defineChain(...)` would throw
 * on first import, before `main.tsx` ever gets a chance to call
 * `setWalletConnectConfig()`. Memoized so repeated calls after the first
 * return the same object identity (AppKit/wagmi compare network objects by
 * reference in places).
 */
let cached: HoodiChain | undefined;

export function getHoodiChain(): HoodiChain {
  if (cached) return cached;
  const config = getWalletConnectConfig();
  cached = defineChain({
    id: config.evmChainId,
    caipNetworkId: `eip155:${config.evmChainId}` as `eip155:${number}`,
    chainNamespace: "eip155",
    name: "Hoodi",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [config.evmRpcUrl] } },
    blockExplorers: {
      default: { name: "Hoodi Explorer", url: "https://hoodi.etherscan.io" },
    },
    testnet: true,
  });
  return cached;
}

/** Test helper — clears the memoized chain so tests can reconfigure. FOR TESTS ONLY. */
export function _resetHoodiChainForTests(): void {
  cached = undefined;
}
