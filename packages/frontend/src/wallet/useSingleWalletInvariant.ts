// spec: docs/frontend/wallet-flows.md#single-connected-wallet
import { useEffect, useRef } from "react";
import { useWalletPresence } from "./useWalletPresence";

const LEGACY_VIEW_KEY = "pipeline.wallet.view.kind";

function removeLegacyViewKey() {
  try {
    localStorage.removeItem(LEGACY_VIEW_KEY);
  } catch {
    return;
  }
}

export function useSingleWalletInvariant(): void {
  const { isAnyConnected, isSettled, onlyConnectedKind, disconnectAll } =
    useWalletPresence();
  const cleaned = useRef(false);

  useEffect(removeLegacyViewKey, []);

  useEffect(() => {
    if (cleaned.current || !isSettled) return;
    if (!isAnyConnected || onlyConnectedKind !== undefined) return;
    cleaned.current = true;
    disconnectAll();
  }, [isSettled, isAnyConnected, onlyConnectedKind, disconnectAll]);
}
