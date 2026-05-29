/**
 * AppKit / wagmi adapter construction.
 *
 * `createAppKit` is called once at module load (module scope, not inside a
 * render function) so React StrictMode's double-mount does not double-init
 * the modal.
 *
 * Features disabled: analytics, email, socials, swaps, onramp — this Issue
 * only needs the basic connect modal.
 */
import { createAppKit } from "@reown/appkit/react";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { http } from "viem";
import { ENV } from "@/lib/env";
import { hoodi } from "./chain";

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
  networks: [hoodi],
  projectId,
  transports: {
    [hoodi.id]: http(ENV.EVM_RPC_URL),
  },
});

createAppKit({
  adapters: [wagmiAdapter],
  networks: [hoodi],
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
