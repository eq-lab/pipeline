/**
 * StellarWalletProvider — lightweight mount point for the Stellar wallet namespace.
 *
 * For this plumbing issue the provider is intentionally thin: it simply
 * renders `children` and serves as the future attachment point for any
 * Stellar-specific context or state (e.g. a Horizon QueryClient in sub-issue 2).
 *
 * Importing `./config` at the top ensures that `StellarWalletsKit.init(...)` is
 * called when this module loads — mirroring how `evm/config.ts` is triggered by
 * `EvmWalletProvider` importing it.
 *
 * Mount this INSIDE `<EvmWalletProvider>` so it sits within the shared
 * TanStack `QueryClientProvider` for sub-issue 2's balance hooks.
 *
 * Do NOT call `installSameTabMockBridge` here — the bridge is already installed
 * by `EvmWalletProvider` and covers all `pipeline.mock.*` keys.
 */
import React from "react";
// Side-effect: initialises the StellarWalletsKit singleton.
import "./config";

export function StellarWalletProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
