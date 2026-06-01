/**
 * Public Stellar wallet hook.
 *
 * Returns `{ address, isConnected, connect, disconnect }` backed by the
 * @creit.tech/stellar-wallets-kit v2.x singleton SDK API.
 *
 * Mock layer: when `pipeline.mock.wallet.stellar.address` is set in localStorage,
 * `connect()` and `disconnect()` are no-ops (dev affordance, gate is bypassed).
 *
 * Terms gate: `connect()` routes through the shared chain-agnostic gate (same
 * `FirstConnectionModal` instance as EVM) before calling `StellarWalletsKit.authModal()`.
 * When the user has already acknowledged (any chain), `authModal()` is called directly.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { StellarWalletsKit } from "./config";
import { useMockStellarAddress, useMockStellarIsConnected } from "./mock";
import { readTermsAcknowledged } from "../useTermsAcknowledgement";
import { useWalletGate } from "../WalletGateContext";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StellarWalletState {
  /** Stellar public key of the connected wallet, or `undefined` when disconnected. */
  address: string | undefined;
  /** `true` when a wallet is connected (or mocked). */
  isConnected: boolean;
  /**
   * Open the Stellar wallet-picker modal.
   *
   * - When a mock address is set: no-op (dev affordance).
   * - When terms are not yet acknowledged: opens the terms gate; connect
   *   proceeds after the user attests.
   * - When terms are already acknowledged: calls `StellarWalletsKit.authModal()`
   *   directly.
   *
   * Returns `void` (fire-and-forget; state updates happen asynchronously).
   */
  connect(): void;
  /**
   * Disconnect the Stellar wallet and clear local state.
   *
   * - When a mock address is set: no-op + console warning (dev affordance).
   */
  disconnect(): void;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useStellarWallet(): StellarWalletState {
  const [realAddress, setRealAddress] = useState<string | undefined>(undefined);
  const unmountedRef = useRef(false);

  const mockAddress = useMockStellarAddress();
  const mockIsConnected = useMockStellarIsConnected();
  const { openGate } = useWalletGate();

  // On mount, try to read the last-known address from kit memory.
  // The kit persists the last connected wallet/address, so on page reload a
  // returning user can skip the picker if they are still connected.
  useEffect(() => {
    unmountedRef.current = false;
    void (async () => {
      try {
        const { address } = await StellarWalletsKit.getAddress();
        if (!unmountedRef.current && address) {
          setRealAddress(address);
        }
      } catch {
        // No prior connection — leave address undefined.
      }
    })();
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  // Resolved values — mock wins over real (same precedence as EVM).
  const address = mockAddress ?? realAddress;
  const isConnected =
    mockIsConnected !== undefined
      ? mockIsConnected
      : mockAddress !== undefined
        ? true
        : realAddress !== undefined;

  /**
   * The actual kit connect flow. Opens the picker modal, waits for the user to
   * select a wallet, and stores the returned public key.
   */
  const runConnect = useCallback(async () => {
    try {
      const { address: newAddress } = await StellarWalletsKit.authModal();
      if (!unmountedRef.current) {
        setRealAddress(newAddress);
      }
    } catch {
      // User dismissed the picker or the kit rejected — leave state unchanged.
    }
  }, []);

  const connect = useCallback(() => {
    // Mock short-circuit — dev affordance, bypasses the terms gate.
    if (mockAddress !== undefined) {
      return;
    }

    // Check terms acknowledgement synchronously (chain-agnostic).
    if (!readTermsAcknowledged()) {
      openGate(() => void runConnect());
      return;
    }

    void runConnect();
  }, [mockAddress, openGate, runConnect]);

  const disconnect = useCallback(() => {
    if (mockAddress !== undefined) {
      console.warn(
        "[stellar mock] To disconnect the mock Stellar wallet, clear the localStorage keys:\n" +
          "  localStorage.removeItem('pipeline.mock.wallet.stellar.address')\n" +
          "  localStorage.removeItem('pipeline.mock.wallet.stellar.isConnected')",
      );
      return;
    }
    setRealAddress(undefined);
    void StellarWalletsKit.disconnect();
  }, [mockAddress]);

  return { address, isConnected, connect, disconnect };
}
