// spec: docs/frontend/auth-components.md#authflowprovider
import { createContext, useContext } from "react";
import type { EmailAuthScreen } from "@/components/useEmailAuthFlow";
import type { LpReadState } from "@/components/homeState";
import type { LpResponse } from "@/api";
import type { SettlementRowView } from "@/components/account/settlementAddress";

export interface AuthFlowContextValue {
  open(screen?: EmailAuthScreen): void;
  close(): void;
  lpRead: LpReadState;
  kybStatus?: string;
  openAccountSetup(): void;
  openAddEmail(): void;
  adoptLp(lp: LpResponse): void;
  settlement: SettlementRowView;
}

export const AuthFlowContext = createContext<AuthFlowContextValue | null>(null);

export function useAuthFlow(): AuthFlowContextValue {
  const ctx = useContext(AuthFlowContext);
  if (!ctx) {
    throw new Error("useAuthFlow must be used within an AuthFlowProvider");
  }
  return ctx;
}
