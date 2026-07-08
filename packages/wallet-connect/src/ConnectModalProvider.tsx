/**
 * ConnectModalProvider — single ConnectWalletModal instance for the whole app.
 *
 * Ported from `packages/frontend/src/wallet/ConnectModalProvider.tsx` (#791
 * shared-slice extraction), decoupled from the LP terms gate: `open()` now
 * routes through this package's own injectable `WalletGateContext` (a no-op
 * by default — see `./WalletGateContext.ts`) instead of the LP-specific
 * `readTermsAcknowledged` / `useWalletGate` pairing. Apps that need a terms
 * gate (the LP frontend) mount their own `WalletGateContext.Provider` above
 * this provider; apps that don't (the Trustee) mount none, and `open()`
 * proceeds directly to the wallet picker.
 *
 * Mount once inside `<StellarWalletProvider>` (which in turn is inside
 * `<EvmWalletProvider>`) in the consuming app's `main.tsx`.
 * `ConnectWalletModal` calls `useEvmConnectors()` and `useStellarConnectors()`,
 * which depend on those providers being above this one in the tree.
 *
 * Exposes `{ open, close }` via `ConnectModalContext` so any descendant can
 * open the modal without importing or rendering it directly.
 */
import React, { useCallback, useState } from "react";
import { ConnectModalContext } from "./ConnectModalContext";
import { ConnectWalletModal } from "./ConnectWalletModal";
import { useWalletGate } from "./WalletGateContext";

export function ConnectModalProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const { openGate } = useWalletGate();

  const openModal = useCallback(() => setIsOpen(true), []);

  // Routes through the injected gate first (no-op — immediate proceed — by
  // default; the LP app's real terms gate intercepts here when mounted).
  const open = useCallback(() => {
    openGate(openModal);
  }, [openGate, openModal]);

  const close = useCallback(() => setIsOpen(false), []);

  return (
    <ConnectModalContext.Provider value={{ open, close }}>
      {children}
      <ConnectWalletModal open={isOpen} onDismiss={close} />
    </ConnectModalContext.Provider>
  );
}
