import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { WalletProvider } from "@/wallet";
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
    <WalletProvider>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </WalletProvider>
  </StrictMode>,
);
