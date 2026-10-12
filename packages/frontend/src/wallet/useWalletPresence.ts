// spec: docs/frontend/hooks.md#usewalletpresence
import { useEvmWallet } from "./evm/useEvmWallet";
import { useStellarWallet } from "./stellar/useStellarWallet";

export interface UseWalletPresenceResult {
  isAnyConnected: boolean;
  isSettled: boolean;
  disconnectAll: () => void;
}

export function useWalletPresence(): UseWalletPresenceResult {
  const evm = useEvmWallet();
  const stellar = useStellarWallet();

  function disconnectAll() {
    if (evm.isConnected) evm.disconnect();
    if (stellar.isConnected) stellar.disconnect();
  }

  return {
    isAnyConnected: evm.isConnected || stellar.isConnected,
    isSettled: evm.isSettled && stellar.isSettled,
    disconnectAll,
  };
}

export default useWalletPresence;
