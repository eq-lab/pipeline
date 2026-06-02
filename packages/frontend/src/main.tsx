import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import {
  EvmWalletProvider,
  StellarWalletProvider,
  WalletGateProvider,
  WalletViewProvider,
} from "@/wallet";
import { ToastProvider } from "@/lib/toast";

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");

createRoot(rootElement).render(
  <StrictMode>
    <WalletGateProvider>
      <EvmWalletProvider>
        <StellarWalletProvider>
          <WalletViewProvider>
            <ToastProvider>
              <RouterProvider router={router} />
            </ToastProvider>
          </WalletViewProvider>
        </StellarWalletProvider>
      </EvmWalletProvider>
    </WalletGateProvider>
  </StrictMode>,
);
