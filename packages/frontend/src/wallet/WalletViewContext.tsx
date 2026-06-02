/**
 * WalletViewContext — view-only namespace selector for the wallet UI.
 *
 * Tracks which wallet namespace (EVM or Stellar) is currently being viewed
 * in the dropdown and TopBar pill. Selecting a namespace is a view switch
 * only — it never disconnects the other namespace.
 *
 * Safe default when used outside `WalletViewProvider`:
 *   `{ kind: 'evm', setKind: () => {} }` — mirrors the no-op fallback
 *   pattern of `useWalletGate` so isolated tests don't need to wrap a new
 *   provider.
 */
import { createContext, useContext, useState } from "react";
import React from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type WalletViewKind = "evm" | "stellar";

export interface WalletViewContextValue {
  kind: WalletViewKind;
  setKind: (k: WalletViewKind) => void;
}

// ── Context ───────────────────────────────────────────────────────────────────

const WalletViewContext = createContext<WalletViewContextValue | null>(null);

/** No-op fallback: EVM is the default view when called outside the provider. */
const DEFAULT_VALUE: WalletViewContextValue = {
  kind: "evm",
  setKind: () => {},
};

// ── Provider ──────────────────────────────────────────────────────────────────

export function WalletViewProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [kind, setKind] = useState<WalletViewKind>("evm");
  return (
    <WalletViewContext.Provider value={{ kind, setKind }}>
      {children}
    </WalletViewContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Returns the current wallet view kind and a setter.
 *
 * When called outside a `WalletViewProvider` tree (e.g., in isolated tests
 * that render only a partial provider tree) returns the safe default
 * `{ kind: 'evm', setKind: () => {} }` instead of throwing.
 */
export function useWalletView(): WalletViewContextValue {
  const ctx = useContext(WalletViewContext);
  return ctx ?? DEFAULT_VALUE;
}
