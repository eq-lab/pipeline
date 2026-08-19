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

// Must precede render (the wallet providers init their kits lazily on first
// render). spec: docs/frontend/trustee-flows.md#app-bootstrap--providers.
setWalletConnectConfig({
  evmChainId: ENV.EVM_CHAIN_ID,
  evmRpcUrl: ENV.EVM_RPC_URL,
  walletConnectProjectId: ENV.WALLETCONNECT_PROJECT_ID,
  stellarNetworkPassphrase: ENV.STELLAR_NETWORK_PASSPHRASE,
  appName: "Pipeline Trustee",
  appDescription: "Pipeline Trustee Admin Panel",
});

// Module-level singleton so StrictMode's double-mount doesn't create two
// clients. spec: docs/frontend/trustee-flows.md#app-bootstrap--providers.
const queryClient = new QueryClient();

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");

// Provider order/omissions:
// spec: docs/frontend/trustee-flows.md#app-bootstrap--providers.
createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <EvmWalletProvider>
        <StellarWalletProvider>
          <ConnectModalProvider signMessageOnly>
            <RouterProvider router={router} />
          </ConnectModalProvider>
        </StellarWalletProvider>
      </EvmWalletProvider>
    </QueryClientProvider>
  </StrictMode>,
);
