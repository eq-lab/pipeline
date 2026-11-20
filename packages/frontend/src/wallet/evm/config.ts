// spec: packages/frontend/src/wallet/README.md#evmwalletprovider and "E2E test wallet"
import { createAppKit } from "@reown/appkit/react";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { http } from "viem";
import { ENV } from "@/lib/env";
import { evmChain } from "./chain";

const projectId = ENV.WALLETCONNECT_PROJECT_ID;

/** Read a CSS custom property from :root (safe for non-DOM environments). */
function cssVar(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const val = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return val || undefined;
}

export const wagmiAdapter = new WagmiAdapter({
  networks: [evmChain],
  projectId,
  transports: {
    [evmChain.id]: http(ENV.EVM_RPC_URL),
  },
});

createAppKit({
  adapters: [wagmiAdapter],
  networks: [evmChain],
  projectId,
  metadata: {
    name: "Pipeline",
    description: "Pipeline LP Dashboard",
    url: typeof window !== "undefined" ? window.location.origin : "",
    icons: [],
  },
  themeMode: "light",
  themeVariables: {
    "--w3m-accent": cssVar("--color-pipeline-brand") ?? "#000080",
    "--w3m-color-mix": cssVar("--color-pipeline-surface") ?? "#ffffff",
    "--w3m-border-radius-master": cssVar("--radius-pipeline-button") ?? "6px",
  },
  features: {
    analytics: false,
    email: false,
    socials: false,
    swaps: false,
    onramp: false,
  },
});

/**
 * The wagmi `Config` object consumed by `WagmiProvider` in `WalletProvider`.
 */
export const wagmiConfig = wagmiAdapter.wagmiConfig;

/* eslint-disable no-restricted-syntax */
export const E2E_EVM_WALLET_ID: string | undefined =
  import.meta.env.DEV &&
  import.meta.env.VITE_E2E_WALLET &&
  evmChain.id === 31337
    ? "pipeline-e2e-evm-wallet"
    : undefined;

if (import.meta.env.DEV && E2E_EVM_WALLET_ID)
  void import("@pipeline/wallet-connect/e2e-evm-wallet").then(
    ({ e2eEvmConnector }) => {
      const e2e = e2eEvmConnector(import.meta.env, evmChain.id);
      const { connectors } = wagmiConfig._internal;
      if (e2e) connectors.setState((x) => [...x, connectors.setup(e2e)]);
    },
  );
/* eslint-enable no-restricted-syntax */
