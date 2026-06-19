/**
 * Public Stellar wallet hook.
 *
 * Returns `{ address, isConnected, connect, disconnect }` backed by the
 * @creit.tech/stellar-wallets-kit v2.x singleton SDK API.
 *
 * Connection state is shared across all `useStellarWallet()` consumers via a
 * module-level external store (`connectionStore.ts`). Connecting or
 * disconnecting in any component immediately propagates to every other consumer
 * without a page reload. This mirrors how wagmi maintains a single shared store
 * for EVM wallet state.
 *
 * Mock layer: when `pipeline.mock.wallet.stellar.address` is set in localStorage,
 * `connect()` and `disconnect()` are no-ops (dev affordance, gate is bypassed).
 *
 * Terms gate: `connect()` routes through the shared chain-agnostic gate (same
 * `FirstConnectionModal` instance as EVM) before calling `StellarWalletsKit.authModal()`.
 * When the user has already acknowledged (any chain), `authModal()` is called directly.
 */
import { useCallback, useEffect } from "react";
import {
  StellarWalletsKit,
  LOBSTR_ID,
  FREIGHTER_ID,
  XBULL_ID,
  HANA_ID,
  ALBEDO_ID,
  RABET_ID,
} from "./config";
import { networkPassphrase } from "./chain";
import { useMockStellarAddress, useMockStellarIsConnected } from "./mock";
import { readTermsAcknowledged } from "../useTermsAcknowledgement";
import { useWalletGate } from "../WalletGateContext";
import {
  useStellarConnectionAddress,
  setStellarConnectionAddress,
  isStellarConnectionHydrated,
  markStellarConnectionHydrated,
} from "./connectionStore";

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
  /**
   * Sign a transaction XDR with the connected wallet.
   *
   * Delegates to `StellarWalletsKit.signTransaction` using the connected
   * address and the configured network passphrase as defaults. Both can be
   * overridden via `opts`.
   *
   * Mock path: when `pipeline.mock.wallet.stellar.address` is set in
   * localStorage, `signTransaction` **rejects** with a clear error message —
   * real Soroban signing is not mockable at the kit layer. The Blend write
   * hooks mock at their own result-level keys instead, so `signTransaction`
   * is never called on the mock path.
   *
   * @param xdrStr - base64 XDR of the transaction envelope to sign.
   * @param opts - optional overrides for `networkPassphrase` and `address`.
   * @returns `{ signedTxXdr, signerAddress? }` on success.
   */
  signTransaction(
    xdrStr: string,
    opts?: { networkPassphrase?: string; address?: string },
  ): Promise<{ signedTxXdr: string; signerAddress?: string }>;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useStellarWallet(): StellarWalletState {
  // Read from the shared module-level store — reactive across all consumers.
  const realAddress = useStellarConnectionAddress();

  const mockAddress = useMockStellarAddress();
  const mockIsConnected = useMockStellarIsConnected();
  const { openGate } = useWalletGate();

  // On mount, try to read the last-known address from kit memory.
  // Guarded by a module-level `hydrated` flag so only one instance fires
  // `getAddress()` per page lifetime (the store is shared; subsequent mounts
  // already have the address in the store).
  useEffect(() => {
    if (isStellarConnectionHydrated()) return;
    markStellarConnectionHydrated();

    void (async () => {
      try {
        const { address } = await StellarWalletsKit.getAddress();
        if (address) {
          setStellarConnectionAddress(address);
        }
      } catch {
        // No prior connection — leave address undefined.
      }
    })();
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
   * select a wallet, and stores the returned public key in the shared store.
   */
  const runConnect = useCallback(async () => {
    try {
      const { address: newAddress } = await StellarWalletsKit.authModal();
      setStellarConnectionAddress(newAddress);
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
    setStellarConnectionAddress(undefined);
    void StellarWalletsKit.disconnect();
  }, [mockAddress]);

  const signTransaction = useCallback(
    async (
      xdrStr: string,
      opts?: { networkPassphrase?: string; address?: string },
    ): Promise<{ signedTxXdr: string; signerAddress?: string }> => {
      // Mock path: signing a real Soroban tx is not mockable at the kit layer.
      // The Blend hooks mock at their own result-level keys — signTransaction
      // should never be reached on the mock path, but guard clearly anyway.
      if (mockAddress !== undefined) {
        return Promise.reject(
          new Error(
            "[stellar mock] signTransaction is not mockable; use the Blend hook mock keys instead",
          ),
        );
      }

      const result = await StellarWalletsKit.signTransaction(xdrStr, {
        networkPassphrase:
          opts?.networkPassphrase ?? (networkPassphrase as string),
        address: opts?.address ?? address,
      });
      return result;
    },
    [mockAddress, address],
  );

  return { address, isConnected, connect, disconnect, signTransaction };
}

// ── Per-wallet Soroban connect hook ───────────────────────────────────────────

/**
 * Well-known Soroban wallet IDs (the subset the app exposes in the Connect modal).
 */
export type SorobanWalletId =
  | typeof LOBSTR_ID
  | typeof FREIGHTER_ID
  | typeof XBULL_ID
  | typeof HANA_ID
  | typeof ALBEDO_ID
  | typeof RABET_ID;

export interface UseStellarConnectorsResult {
  /**
   * Connect to a specific Soroban wallet by its kit module id.
   *
   * - When a mock address is set: no-op (dev affordance).
   * - Otherwise: calls `StellarWalletsKit.setWallet(id)` then
   *   `StellarWalletsKit.fetchAddress()` and stores the returned address in the
   *   shared connection store so ALL `useStellarWallet()` consumers update.
   *
   * If the wallet is not installed/available, the kit will throw; callers
   * should handle errors (e.g. open the wallet's website in a new tab).
   *
   * The terms gate is no longer triggered here. It is interposed by
   * `ConnectModalProvider.open()` before `ConnectWalletModal` opens, so the
   * gate always precedes the wallet picker (issue #639).
   */
  connectWallet(walletId: string, onUnavailable?: () => void): Promise<void>;
}

export function useStellarConnectors(): UseStellarConnectorsResult {
  const mockAddress = useMockStellarAddress();

  const connectWallet = useCallback(
    async (walletId: string, onUnavailable?: () => void): Promise<void> => {
      if (mockAddress !== undefined) {
        return;
      }

      try {
        StellarWalletsKit.setWallet(walletId);
        const { address: newAddress } = await StellarWalletsKit.fetchAddress();
        // Update the shared store so ALL consumers see the new address.
        setStellarConnectionAddress(newAddress);
      } catch {
        // Wallet unavailable — invoke callback so the caller can redirect.
        onUnavailable?.();
      }
    },
    [mockAddress],
  );

  return { connectWallet };
}
