// spec: docs/FRONTEND.md#page-url-canonicalisation-and-boot-guard
import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import {
  ConnectModalProvider,
  EvmChainAutoSwitch,
  EvmWalletProvider,
  StellarWalletProvider,
  WalletGateProvider,
  WalletViewProvider,
} from "@/wallet";
import { ToastProvider } from "@/lib/toast";
import { AuthFlowProvider } from "@/auth";
import { claimAppBoot } from "@/lib/bootGuard";

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");

if (claimAppBoot(rootElement)) {
  createRoot(rootElement).render(
    <StrictMode>
      <WalletGateProvider>
        <EvmWalletProvider>
          <StellarWalletProvider>
            <ConnectModalProvider>
              <AuthFlowProvider>
                <WalletViewProvider>
                  <EvmChainAutoSwitch />
                  <ToastProvider>
                    <RouterProvider router={router} />
                  </ToastProvider>
                </WalletViewProvider>
              </AuthFlowProvider>
            </ConnectModalProvider>
          </StellarWalletProvider>
        </EvmWalletProvider>
      </WalletGateProvider>
    </StrictMode>,
  );
}
