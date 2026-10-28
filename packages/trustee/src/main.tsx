// spec: docs/frontend/trustee-flows.md#app-bootstrap--providers
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
import { AppErrorBoundary, AppErrorView } from "@/components/AppErrorBoundary";
import { installGlobalErrorReporting } from "@/lib/diagnostics";
import { claimAppBoot } from "@/lib/bootGuard";

const queryClient = new QueryClient();

const router = createRouter({
  routeTree,
  defaultErrorComponent: AppErrorView,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");

if (claimAppBoot(rootElement)) {
  setWalletConnectConfig({
    evmChainId: ENV.EVM_CHAIN_ID,
    evmRpcUrl: ENV.EVM_RPC_URL,
    walletConnectProjectId: ENV.WALLETCONNECT_PROJECT_ID,
    stellarNetworkPassphrase: ENV.STELLAR_NETWORK_PASSPHRASE,
    appName: "Pipeline Trustee",
    appDescription: "Pipeline Trustee Admin Panel",
  });

  installGlobalErrorReporting(router);

  createRoot(rootElement).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <EvmWalletProvider>
          <StellarWalletProvider>
            <ConnectModalProvider signMessageOnly>
              <AppErrorBoundary router={router}>
                <RouterProvider router={router} />
              </AppErrorBoundary>
            </ConnectModalProvider>
          </StellarWalletProvider>
        </EvmWalletProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}
