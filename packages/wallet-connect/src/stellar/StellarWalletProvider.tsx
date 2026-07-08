/**
 * StellarWalletProvider — lightweight mount point for the Stellar wallet namespace.
 *
 * Calls `initStellarWalletConnect()` on first render (not at module load —
 * see `./config`'s doc comment) to initialise the `StellarWalletsKit`
 * singleton, memoized via `useState`'s lazy initializer so it runs exactly
 * once even under StrictMode's double-render.
 *
 * Mount this INSIDE `<EvmWalletProvider>` so it sits within the shared
 * TanStack `QueryClientProvider`.
 *
 * Do NOT call `installSameTabMockBridge` here — the bridge is already installed
 * by `EvmWalletProvider` and covers all `pipeline.mock.*` keys.
 */
import React, { useState } from "react";
import { initStellarWalletConnect } from "./config";

export function StellarWalletProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  useState(() => initStellarWalletConnect());
  return <>{children}</>;
}
