import React, { useCallback, useEffect, useRef, useState } from "react";
import { WagmiProvider, useAccount } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAppKit } from "@reown/appkit/react";
import { wagmiConfig } from "./config";
import { installSameTabMockBridge } from "./mock";
import { WalletGateContext } from "./WalletGateContext";
import { FirstConnectionModal } from "../../components/FirstConnectionModal";
import { readTermsAcknowledged } from "./useTermsAcknowledgement";

/**
 * Singleton QueryClient — created once outside the component so React
 * StrictMode's double-mount doesn't create two clients.
 */
const queryClient = new QueryClient();

/**
 * The localStorage key used when a user acknowledges before their address is
 * known (i.e., on their very first ever connect where they haven't connected
 * before in this browser). When the address becomes available after AppKit
 * completes, we migrate this flag to the address-scoped key.
 */
const PENDING_ACK_KEY = "pipeline.wallet.termsAcknowledged.pending";

/**
 * Inner provider that has access to the AppKit context (must be inside
 * WagmiProvider + QueryClientProvider).
 *
 * Responsibilities:
 *  1. Mount the `FirstConnectionModal` and manage its open/close state.
 *  2. Expose `openGate()` via `WalletGateContext` so `useWallet().connect()`
 *     can trigger the modal without a direct component dependency.
 *  3. When the user completes attestation, call AppKit `open()` then
 *     close the modal.
 *  4. Handle address-scoped acknowledgement:
 *     - If `address` is known at acknowledge time, write the address-scoped key.
 *     - If `address` is unknown (first-ever connect), write a pending key and
 *       migrate it to the address-scoped key once the address becomes available.
 */
function WalletGateProvider({ children }: { children: React.ReactNode }) {
  const { open } = useAppKit();
  const { address } = useAccount();
  const [gateOpen, setGateOpen] = useState(false);
  // Whether we are waiting for the address to become available so we can
  // persist the address-scoped acknowledgement (post-connect migration).
  const pendingAckRef = useRef(false);

  // Track the element that triggered the gate so focus can be restored on close.
  const triggerRef = useRef<HTMLElement | null>(null);

  const openGate = useCallback(() => {
    // Deduplicate: if gate is already open do nothing.
    if (gateOpen) return;
    // Capture current focus for restoration.
    triggerRef.current = document.activeElement as HTMLElement | null;
    setGateOpen(true);
  }, [gateOpen]);

  /**
   * Acknowledge terms for the given address.
   * If `addr` is defined, writes the address-scoped key immediately.
   * Otherwise, writes the pending key and sets `pendingAckRef` so we
   * migrate once the address is known.
   */
  function acknowledgeForAddress(addr: string | undefined) {
    if (addr) {
      const key = `pipeline.wallet.termsAcknowledged.${addr.toLowerCase()}`;
      try {
        localStorage.setItem(key, "true");
      } catch {
        // localStorage unavailable — skip silently.
      }
    } else {
      // Address not yet known; write pending key and arrange migration.
      try {
        localStorage.setItem(PENDING_ACK_KEY, "true");
        pendingAckRef.current = true;
      } catch {
        // localStorage unavailable.
      }
    }
  }

  // Migration: once `address` becomes available and we have a pending ack,
  // write the address-scoped key and clear the pending one.
  useEffect(() => {
    if (!address || !pendingAckRef.current) return;

    const pending = (() => {
      try {
        return localStorage.getItem(PENDING_ACK_KEY) === "true";
      } catch {
        return false;
      }
    })();

    if (pending) {
      const key = `pipeline.wallet.termsAcknowledged.${address.toLowerCase()}`;
      try {
        localStorage.setItem(key, "true");
        localStorage.removeItem(PENDING_ACK_KEY);
      } catch {
        // localStorage unavailable.
      }
      pendingAckRef.current = false;
    }
  }, [address]);

  const handleContinue = useCallback(() => {
    setGateOpen(false);
    // Acknowledge for the currently-known address (may be undefined for
    // first-ever connect; handled by acknowledgeForAddress).
    acknowledgeForAddress(address);
    // Restore focus before AppKit opens (AppKit may move focus itself).
    triggerRef.current?.focus();
    triggerRef.current = null;
    void open();
  }, [open, address]);

  const handleDismiss = useCallback(() => {
    setGateOpen(false);
    // Restore focus to the trigger element.
    triggerRef.current?.focus();
    triggerRef.current = null;
  }, []);

  // Additional guard: if the user somehow already has the ack flag set when the
  // modal is open (e.g., another tab wrote it), close the gate automatically.
  useEffect(() => {
    if (gateOpen && readTermsAcknowledged(address)) {
      setGateOpen(false);
    }
  }, [gateOpen, address]);

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

/**
 * Top-level provider that wires wagmi + TanStack Query into the React tree.
 *
 * Mount this once, above `RouterProvider` in `main.tsx`.
 *
 * On mount it also installs the same-tab localStorage mock bridge, which
 * patches `localStorage.setItem`/`removeItem` so that keys written from the
 * DevTools console dispatch the `pipeline-mock:wallet` custom event and cause
 * the wallet hooks to re-render without a page reload.
 *
 * Also mounts the `FirstConnectionModal` via `WalletGateProvider` so any
 * call to `useWallet().connect()` with no terms acknowledgement triggers the
 * terms gate before AppKit is opened.
 */
export function EvmWalletProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    return installSameTabMockBridge();
  }, []);

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <WalletGateProvider>{children}</WalletGateProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
