/**
 * ConnectModalProvider — single ConnectWalletModal instance for the whole app.
 *
 * Mount once inside `<StellarWalletProvider>` (which in turn is inside
 * `<EvmWalletProvider>` and `<WalletGateProvider>`) in `main.tsx`.
 * `ConnectWalletModal` calls `useEvmConnectors()` and `useStellarConnectors()`,
 * which depend on those providers being above this one in the tree.
 *
 * Exposes `{ open, close }` via `ConnectModalContext` so any descendant can
 * open the modal without importing or rendering it directly.
 *
 * Note: Issue #639 will later interpose the first-connection terms gate in
 * front of `open()`. The `open()` API is intentionally gate-agnostic here;
 * the gate is currently still triggered inside the per-wallet `connectWallet()`
 * hooks and #639 will move it upstream to this provider.
 *
 * Mirrors the structure of `WalletGateProvider.tsx`:
 *   - Imports a modal component from `../components/`.
 *   - Owns the open/close boolean state.
 *   - Provides the context value to descendants.
 */
import React, { useCallback, useState } from "react";
import { ConnectModalContext } from "./ConnectModalContext";
import { ConnectWalletModal } from "../components/ConnectWalletModal";

export function ConnectModalProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  return (
    <ConnectModalContext.Provider value={{ open, close }}>
      {children}
      <ConnectWalletModal open={isOpen} onDismiss={close} />
    </ConnectModalContext.Provider>
  );
}
