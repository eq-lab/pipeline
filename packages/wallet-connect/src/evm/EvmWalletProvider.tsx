import React, { useEffect, useState } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { initEvmWalletConnect } from "./config";
import { installSameTabMockBridge } from "./mock";

/**
 * Singleton QueryClient — created once outside the component so React
 * StrictMode's double-mount doesn't create two clients.
 */
const queryClient = new QueryClient();

/**
 * Top-level EVM provider that wires wagmi + TanStack Query into the React tree.
 *
 * Mount this inside the consuming app's gate provider (if any), above
 * `<StellarWalletProvider>` and the router.
 *
 * Calls `initEvmWalletConnect()` on first render (not at module load — see
 * `./config`'s doc comment for why module-scope AppKit/wagmi construction is
 * incompatible with runtime-injected config) to obtain the wagmi `Config`,
 * memoized in local state so the one-time `createAppKit`/`WagmiAdapter`
 * construction happens exactly once even under StrictMode's double-render.
 *
 * On mount it also installs the same-tab localStorage mock bridge, which
 * patches `localStorage.setItem`/`removeItem` so that keys written from the
 * DevTools console dispatch the `pipeline-mock:wallet` custom event and cause
 * the wallet hooks to re-render without a page reload. This bridge covers ALL
 * `pipeline.mock.*` keys — including Stellar mock keys — so
 * `StellarWalletProvider` must NOT install a second bridge.
 */
export function EvmWalletProvider({ children }: { children: React.ReactNode }) {
  // Lazy, memoized one-time init — see module doc comment above.
  const [wagmiConfig] = useState(() => initEvmWalletConnect());

  useEffect(() => {
    return installSameTabMockBridge();
  }, []);

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
