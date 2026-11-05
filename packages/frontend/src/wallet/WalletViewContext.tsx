// spec: docs/frontend/hooks.md#usewalletview
import { createContext, useContext } from "react";
import React from "react";
import { useEvmWallet } from "./evm/useEvmWallet";
import { useStellarWallet } from "./stellar/useStellarWallet";
import { useSingleWalletInvariant } from "./useSingleWalletInvariant";
import { walletPrecedence, type WalletViewKind } from "./walletPrecedence";

// ── Types ─────────────────────────────────────────────────────────────────────

export type { WalletViewKind };

export interface WalletViewContextValue {
  kind: WalletViewKind;
}

// ── Context ───────────────────────────────────────────────────────────────────

const WalletViewContext = createContext<WalletViewContextValue | null>(null);

const DEFAULT_KIND: WalletViewKind = "evm";
const DEFAULT_VALUE: WalletViewContextValue = { kind: DEFAULT_KIND };

// ── Provider ──────────────────────────────────────────────────────────────────

export function WalletViewProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const evm = useEvmWallet();
  const stellar = useStellarWallet();
  useSingleWalletInvariant();

  const kind: WalletViewKind = walletPrecedence(evm, stellar) ?? DEFAULT_KIND;

  return (
    <WalletViewContext.Provider value={{ kind }}>
      {children}
    </WalletViewContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useWalletView(): WalletViewContextValue {
  const ctx = useContext(WalletViewContext);
  return ctx ?? DEFAULT_VALUE;
}
