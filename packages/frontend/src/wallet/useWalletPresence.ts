// spec: docs/frontend/hooks.md#usewalletpresence
import { useEvmWallet } from "./evm/useEvmWallet";
import { useStellarWallet } from "./stellar/useStellarWallet";
import type { WalletViewKind } from "./WalletViewContext";

export interface UseWalletPresenceResult {
  isAnyConnected: boolean;
  isSettled: boolean;
  isConnectionPending: boolean;
  onlyConnectedKind: WalletViewKind | undefined;
  disconnectAll: () => void;
}

export function useWalletPresence(): UseWalletPresenceResult {
  const evm = useEvmWallet();
  const stellar = useStellarWallet();

  function disconnectAll() {
    if (evm.isConnected) evm.disconnect();
    if (stellar.isConnected) stellar.disconnect();
  }

  const onlyConnectedKind: WalletViewKind | undefined =
    evm.isConnected && !stellar.isConnected
      ? "evm"
      : stellar.isConnected && !evm.isConnected
        ? "stellar"
        : undefined;

  const isAnyConnected = evm.isConnected || stellar.isConnected;
  const isSettled = evm.isSettled && stellar.isSettled;

  return {
    isAnyConnected,
    isSettled,
    isConnectionPending: !isAnyConnected && !isSettled,
    onlyConnectedKind,
    disconnectAll,
  };
}

export default useWalletPresence;
