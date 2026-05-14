import React, { useEffect } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiConfig } from "./config";
import { installSameTabMockBridge } from "./mock";

/**
 * Singleton QueryClient — created once outside the component so React
 * StrictMode's double-mount doesn't create two clients.
 */
const queryClient = new QueryClient();

/**
 * Top-level provider that wires wagmi + TanStack Query into the React tree.
 *
 * Mount this once, above `RouterProvider` in `main.tsx`.
 *
 * On mount it also installs the same-tab localStorage mock bridge, which
 * patches `localStorage.setItem`/`removeItem` so that keys written from the
 * DevTools console dispatch the `pipeline-mock:wallet` custom event and cause
 * the wallet hooks to re-render without a page reload.
 */
export function WalletProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    return installSameTabMockBridge();
  }, []);

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
