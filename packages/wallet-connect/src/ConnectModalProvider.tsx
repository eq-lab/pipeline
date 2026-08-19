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
 * Exposes `{ open, close, onCancel, onWalletSelect }` via `ConnectModalContext`
 * so any descendant can open the modal without importing or rendering it
 * directly, and:
 *   - (#793) callers that set a busy state before opening can reset it via
 *     `onCancel` when the modal is truly cancelled (no wallet chosen) rather
 *     than closed as a side effect of a wallet-row selection.
 *   - (#794) callers that need to know which chain the user actually picked
 *     (e.g. more than one wallet already connected) can subscribe via
 *     `onWalletSelect`.
 */
import React, { useCallback, useRef, useState } from "react";
import { ConnectModalContext } from "./ConnectModalContext";
import { ConnectWalletModal } from "./ConnectWalletModal";
import type { WalletTab } from "./ConnectWalletModal";
import { useWalletGate } from "./WalletGateContext";

export function ConnectModalProvider({
  children,
  signMessageOnly = false,
}: {
  children: React.ReactNode;
  signMessageOnly?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const { openGate } = useWalletGate();

  // Listeners for "the modal was cancelled with no wallet selected" (#793).
  // A ref (not state) — subscribing/unsubscribing must not trigger re-renders.
  const cancelListenersRef = useRef(new Set<() => void>());
  // Listeners for "the user picked a wallet row" (#794), receiving the chain.
  const walletSelectListenersRef = useRef(
    new Set<(chain: WalletTab) => void>(),
  );
  // Set for the duration of a wallet-row click so the ensuing onDismiss (the
  // modal calls onWalletSelect then onDismiss for a real selection) is not
  // also treated as a cancel.
  const walletSelectedRef = useRef(false);

  const openModal = useCallback(() => setIsOpen(true), []);

  // Routes through the injected gate first (no-op — immediate proceed — by
  // default; the LP app's real terms gate intercepts here when mounted).
  const open = useCallback(() => {
    openGate(openModal);
  }, [openGate, openModal]);

  const close = useCallback(() => setIsOpen(false), []);

  // Fired by ConnectWalletModal for a true dismissal (Escape / × button) OR
  // as a side effect of picking a wallet (onWalletSelect fires first in that
  // case, flagging walletSelectedRef so this dismiss is not miscounted as a
  // cancel).
  const handleDismiss = useCallback(() => {
    setIsOpen(false);
    if (walletSelectedRef.current) {
      walletSelectedRef.current = false;
      return;
    }
    cancelListenersRef.current.forEach((listener) => listener());
  }, []);

  const handleWalletSelect = useCallback((chain: WalletTab) => {
    walletSelectedRef.current = true;
    walletSelectListenersRef.current.forEach((listener) => listener(chain));
  }, []);

  const onCancel = useCallback((listener: () => void) => {
    cancelListenersRef.current.add(listener);
    return () => {
      cancelListenersRef.current.delete(listener);
    };
  }, []);

  const onWalletSelect = useCallback((listener: (chain: WalletTab) => void) => {
    walletSelectListenersRef.current.add(listener);
    return () => {
      walletSelectListenersRef.current.delete(listener);
    };
  }, []);

  return (
    <ConnectModalContext.Provider
      value={{ open, close, onCancel, onWalletSelect }}
    >
      {children}
      <ConnectWalletModal
        open={isOpen}
        onDismiss={handleDismiss}
        onWalletSelect={handleWalletSelect}
        signMessageOnly={signMessageOnly}
      />
    </ConnectModalContext.Provider>
  );
}
