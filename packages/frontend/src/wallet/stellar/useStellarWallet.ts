// spec: packages/frontend/src/wallet/README.md#usestellarwallet
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
import {
  useMockStellarAddress,
  useMockStellarIsConnected,
  useBothWalletMocksConnected,
} from "./mock";
import { readTermsAcknowledged } from "../useTermsAcknowledgement";
import { useWalletGate } from "../WalletGateContext";
import {
  useStellarConnectionAddress,
  setStellarConnectionAddress,
  isStellarConnectionHydrated,
  markStellarConnectionHydrated,
  markStellarConnectionSettled,
  useStellarConnectionSettled,
} from "./connectionStore";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StellarWalletState {
  address: string | undefined;
  isConnected: boolean;
  isSettled: boolean;
  connect(): void;
  disconnect(): void;
  signTransaction(
    xdrStr: string,
    opts?: { networkPassphrase?: string; address?: string },
  ): Promise<{ signedTxXdr: string; signerAddress?: string }>;
  signMessage(
    message: string,
    address?: string,
  ): Promise<{ signature: string }>;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useStellarWallet(): StellarWalletState {
  const realAddress = useStellarConnectionAddress();

  const mockAddress = useMockStellarAddress();
  const mockIsConnected = useMockStellarIsConnected();
  const bothMocksConnected = useBothWalletMocksConnected();
  const { openGate } = useWalletGate();
  const connectionSettled = useStellarConnectionSettled();

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
        return;
      } finally {
        markStellarConnectionSettled();
      }
    })();
  }, []);

  const address = mockAddress ?? realAddress;
  const isConnected = bothMocksConnected
    ? false
    : mockIsConnected !== undefined
      ? mockIsConnected
      : mockAddress !== undefined
        ? true
        : realAddress !== undefined;
  const isSettled = mockAddress !== undefined ? true : connectionSettled;

  const runConnect = useCallback(async () => {
    try {
      const { address: newAddress } = await StellarWalletsKit.authModal();
      setStellarConnectionAddress(newAddress);
    } catch {
      return;
    }
  }, []);

  const connect = useCallback(() => {
    if (mockAddress !== undefined) {
      return;
    }

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
      if (mockAddress !== undefined) {
        return Promise.reject(
          new Error(
            "[stellar mock] signTransaction is not mockable; use the write-hook result mock keys instead",
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

  const signMessage = useCallback(
    async (
      message: string,
      signer?: string,
    ): Promise<{ signature: string }> => {
      if (mockAddress !== undefined) {
        return Promise.reject(
          new Error(
            "[stellar mock] signMessage is not mockable; connect a real wallet",
          ),
        );
      }
      const { signedMessage } = await StellarWalletsKit.signMessage(message, {
        networkPassphrase: networkPassphrase as string,
        address: signer ?? address,
      });
      return { signature: signedMessage };
    },
    [mockAddress, address],
  );

  return {
    address,
    isConnected,
    isSettled,
    connect,
    disconnect,
    signTransaction,
    signMessage,
  };
}

// ── Per-wallet Soroban connect hook ───────────────────────────────────────────

export type SorobanWalletId =
  | typeof LOBSTR_ID
  | typeof FREIGHTER_ID
  | typeof XBULL_ID
  | typeof HANA_ID
  | typeof ALBEDO_ID
  | typeof RABET_ID;

export interface UseStellarConnectorsResult {
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
        setStellarConnectionAddress(newAddress);
      } catch {
        onUnavailable?.();
      }
    },
    [mockAddress],
  );

  return { connectWallet };
}
