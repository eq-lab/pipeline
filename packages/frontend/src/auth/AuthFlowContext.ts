// spec: docs/frontend/auth-components.md#authflowprovider
import { createContext, useContext } from "react";
import type { EmailAuthScreen } from "@/components/useEmailAuthFlow";

export interface AuthFlowContextValue {
  open(screen?: EmailAuthScreen): void;
  close(): void;
}

export const AuthFlowContext = createContext<AuthFlowContextValue | null>(null);

export function useAuthFlow(): AuthFlowContextValue {
  const ctx = useContext(AuthFlowContext);
  if (!ctx) {
    throw new Error("useAuthFlow must be used within an AuthFlowProvider");
  }
  return ctx;
}
