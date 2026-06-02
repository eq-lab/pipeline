/**
 * WalletGateProvider — chain-agnostic first-connection terms gate.
 *
 * Mount once above BOTH wallet providers in `main.tsx`. A single
 * `FirstConnectionModal` instance serves EVM and Stellar connects alike.
 *
 * Responsibilities:
 *  1. Render the `FirstConnectionModal` and manage its open/close state.
 *  2. Expose `openGate(onProceed)` via `WalletGateContext` so either wallet
 *     hook can trigger the modal. The caller supplies `onProceed` — the
 *     chain-specific callback to run after the user completes attestation.
 *  3. When the user clicks Continue, write the single
 *     `pipeline.wallet.termsAcknowledged` flag and invoke `onProceed`.
 *  4. Auto-close when the acknowledgement flag is already set (e.g., another
 *     tab wrote it while the modal was open).
 *
 * Decoupled from wagmi / AppKit: this provider knows nothing about EVM or
 * Stellar libraries. Each wallet hook hands it a plain `() => void` callback.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { WalletGateContext } from "./WalletGateContext";
import { FirstConnectionModal } from "../components/FirstConnectionModal";
import {
  readTermsAcknowledged,
  useTermsAcknowledgement,
} from "./useTermsAcknowledgement";

/**
 * Chain-agnostic terms gate provider.
 *
 * Mount above `<EvmWalletProvider>` and `<StellarWalletProvider>` in `main.tsx`.
 */
export function WalletGateProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [gateOpen, setGateOpen] = useState(false);
  // Stored `onProceed` callback from the wallet hook that triggered the gate.
  const onProceedRef = useRef<(() => void) | null>(null);
  // Track the element that triggered the gate so focus can be restored on close.
  const triggerRef = useRef<HTMLElement | null>(null);

  const { acknowledge } = useTermsAcknowledgement();

  const openGate = useCallback(
    (onProceed: () => void) => {
      // Deduplicate: if gate is already open do nothing.
      if (gateOpen) return;
      // Capture current focus for restoration.
      triggerRef.current = document.activeElement as HTMLElement | null;
      onProceedRef.current = onProceed;
      setGateOpen(true);
    },
    [gateOpen],
  );

  const handleContinue = useCallback(() => {
    setGateOpen(false);
    acknowledge();
    // Restore focus before the wallet modal opens (the wallet modal may move focus).
    triggerRef.current?.focus();
    triggerRef.current = null;
    // Invoke the chain-specific connect callback.
    const proceed = onProceedRef.current;
    onProceedRef.current = null;
    proceed?.();
  }, [acknowledge]);

  const handleDismiss = useCallback(() => {
    setGateOpen(false);
    onProceedRef.current = null;
    // Restore focus to the trigger element.
    triggerRef.current?.focus();
    triggerRef.current = null;
  }, []);

  // Additional guard: if the acknowledgement flag is set while the modal is
  // open (e.g., another tab wrote it), close the gate automatically.
  useEffect(() => {
    if (gateOpen && readTermsAcknowledged()) {
      setGateOpen(false);
      onProceedRef.current = null;
    }
  }, [gateOpen]);

  return (
    <WalletGateContext.Provider value={{ openGate }}>
      {children}
      <FirstConnectionModal
        open={gateOpen}
        onContinue={handleContinue}
        onDismiss={handleDismiss}
      />
    </WalletGateContext.Provider>
  );
}
