/**
 * AppKit / wagmi adapter construction.
 *
 * Ported from `packages/frontend/src/wallet/evm/config.ts` (#791 shared-slice
 * extraction), made **lazy**: `initEvmWalletConnect()` calls `createAppKit`
 * exactly once, on first call, instead of at module load. A module-scope
 * `createAppKit(...)` call would read `getWalletConnectConfig()` before the
 * consuming app's `main.tsx` gets a chance to call
 * `setWalletConnectConfig()` — ES module imports are hoisted and evaluated
 * before the importing module's own body runs, so any module-scope read of
 * the injected config throws unconditionally on first import.
 *
 * `initEvmWalletConnect()` is called from `EvmWalletProvider` on render
 * (guarded to run once), which is late enough that `main.tsx` has already
 * configured the package. React StrictMode's double-mount doesn't double-init
 * the modal because of the memoization below.
 *
 * Features disabled: analytics, email, socials, swaps, onramp — this package
 * only needs the basic connect modal.
 */
import { createAppKit } from "@reown/appkit/react";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import type { Config } from "@wagmi/core";
import { http } from "viem";
import { getWalletConnectConfig } from "../config";
import { getHoodiChain } from "./chain";

/** Read a CSS custom property from :root (safe for non-DOM environments). */
function cssVar(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const val = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return val || undefined;
}

let wagmiConfigCache: Config | undefined;

/**
 * Initialises AppKit + the wagmi adapter on first call and returns the wagmi
 * `Config` object consumed by `WagmiProvider`. Idempotent — subsequent calls
 * return the memoized config without re-initialising AppKit.
 */
export function initEvmWalletConnect(): Config {
  if (wagmiConfigCache) return wagmiConfigCache;

  const walletConnectConfig = getWalletConnectConfig();
  const projectId = walletConnectConfig.walletConnectProjectId;
  const hoodi = getHoodiChain();

  const wagmiAdapter = new WagmiAdapter({
    networks: [hoodi],
    projectId,
    transports: {
      [hoodi.id]: http(walletConnectConfig.evmRpcUrl),
    },
  });

  createAppKit({
    adapters: [wagmiAdapter],
    networks: [hoodi],
    projectId,
    metadata: {
      name: walletConnectConfig.appName,
      description: walletConnectConfig.appDescription,
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

  wagmiConfigCache = wagmiAdapter.wagmiConfig;
  return wagmiConfigCache;
}

/** Test helper — clears the memoized wagmi config so tests can reconfigure. FOR TESTS ONLY. */
export function _resetEvmWalletConnectForTests(): void {
  wagmiConfigCache = undefined;
}
