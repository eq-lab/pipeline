// spec: docs/frontend/hooks.md#usewalletpresence
import { useEvmWallet } from "./evm/useEvmWallet";
import { useStellarWallet } from "./stellar/useStellarWallet";
import type { WalletViewKind } from "./WalletViewContext";

export interface UseWalletPresenceResult {
  isAnyConnected: boolean;
  isSettled: boolean;
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

  return {
    isAnyConnected: evm.isConnected || stellar.isConnected,
    isSettled: evm.isSettled && stellar.isSettled,
    onlyConnectedKind,
    disconnectAll,
  };
}

export default useWalletPresence;
