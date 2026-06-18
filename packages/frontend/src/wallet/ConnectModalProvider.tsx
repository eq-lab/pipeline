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
 * Gate ordering (issue #639): `open()` routes through the first-connection
 * terms gate (`WalletGateProvider.openGate`) when terms have not yet been
 * acknowledged. After the user continues, `ConnectWalletModal` opens. When
 * terms are already acknowledged, `ConnectWalletModal` opens immediately.
 * This ensures the gate always precedes the wallet-picker, regardless of
 * which CTA triggered the open.
 *
 * Mirrors the structure of `WalletGateProvider.tsx`:
 *   - Imports a modal component from `../components/`.
 *   - Owns the open/close boolean state.
 *   - Provides the context value to descendants.
 */
import React, { useCallback, useState } from "react";
import { ConnectModalContext } from "./ConnectModalContext";
import { ConnectWalletModal } from "../components/ConnectWalletModal";
import { useWalletGate } from "./WalletGateContext";
import { readTermsAcknowledged } from "./useTermsAcknowledgement";

export function ConnectModalProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const { openGate } = useWalletGate();

  // Private: open the modal unconditionally (used as the onProceed callback
  // passed to the gate, and directly when terms are already acknowledged).
  const openModal = useCallback(() => setIsOpen(true), []);

  // Public: route through the gate first when terms have not been acknowledged.
  const open = useCallback(() => {
    if (readTermsAcknowledged()) {
      openModal();
    } else {
      openGate(openModal);
    }
  }, [openGate, openModal]);

  const close = useCallback(() => setIsOpen(false), []);

  return (
    <ConnectModalContext.Provider value={{ open, close }}>
      {children}
      <ConnectWalletModal open={isOpen} onDismiss={close} />
    </ConnectModalContext.Provider>
  );
}
