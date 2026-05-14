import { defineChain } from "@reown/appkit/networks";
import { ENV } from "@/lib/env";

/**
 * Hoodi testnet chain definition compatible with `@reown/appkit/networks`.
 *
 * Hoodi is not included in the AppKit network catalogue so we define it
 * manually.  Chain identifiers and explorer URL come from:
 * https://github.com/eth-clients/hoodi
 *
 * The chain id and RPC are read from env so a private RPC can replace the
 * public one without a rebuild (`vite-plugin-runtime-env`).
 *
 * Note: the export is named `hoodi` for readability. If `VITE_EVM_CHAIN_ID`
 * is overridden to a different chain at runtime the constant still works —
 * it simply tracks whatever the env points at.
 */
export const hoodi = defineChain({
  id: ENV.EVM_CHAIN_ID,
  caipNetworkId: `eip155:${ENV.EVM_CHAIN_ID}` as `eip155:${number}`,
  chainNamespace: "eip155",
  name: "Hoodi",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [ENV.EVM_RPC_URL] } },
  blockExplorers: {
    default: { name: "Hoodi Explorer", url: "https://hoodi.etherscan.io" },
  },
  testnet: true,
});
