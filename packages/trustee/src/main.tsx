import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  setWalletConnectConfig,
  EvmWalletProvider,
  StellarWalletProvider,
  ConnectModalProvider,
} from "@pipeline/wallet-connect";
import { routeTree } from "./routeTree.gen";
import { ENV } from "@/lib/env";

// Configure the shared wallet-connect slice before rendering
// `EvmWalletProvider`/`StellarWalletProvider` below. Those providers
// initialise AppKit / the Stellar kit lazily on first render (not at module
// load), so this call only needs to precede `createRoot(...).render(...)`,
// not any particular import (#791).
setWalletConnectConfig({
  evmChainId: ENV.EVM_CHAIN_ID,
  evmRpcUrl: ENV.EVM_RPC_URL,
  walletConnectProjectId: ENV.WALLETCONNECT_PROJECT_ID,
  stellarNetworkPassphrase: ENV.STELLAR_NETWORK_PASSPHRASE,
  appName: "Pipeline Trustee",
  appDescription: "Pipeline Trustee Admin Panel",
});

/**
 * Singleton QueryClient — created once outside the component so React
 * StrictMode's double-mount doesn't create two clients. `EvmWalletProvider`
 * mounts its own internal QueryClientProvider for wagmi's needs; this one is
 * for any Trustee-owned data fetching (none yet — added ahead of #779–#782).
 */
const queryClient = new QueryClient();

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");

// Provider order mirrors the LP frontend's `main.tsx`, minus
// `WalletGateProvider` — the Trustee omits the LP first-connection terms gate
// (internal operators; see the #791 exec plan's Decision Log). Without a
// `WalletGateContext.Provider` mounted, `@pipeline/wallet-connect`'s gate
// hooks default to a no-op (immediate proceed).
//
// `TrusteeSessionProvider` is NOT mounted here — it calls `useNavigate()`,
// which needs router context, so it is mounted inside the root route
// (`routes/__root.tsx`), below `<RouterProvider>`.
createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <EvmWalletProvider>
        <StellarWalletProvider>
          <ConnectModalProvider>
            <RouterProvider router={router} />
          </ConnectModalProvider>
        </StellarWalletProvider>
      </EvmWalletProvider>
    </QueryClientProvider>
  </StrictMode>,
);
