// spec: docs/frontend/wallet-flows.md#network-switcher-cross-deployment-links
// (confirm-before-mainnet flow, issue #1032).
import { useCallback, useState } from "react";
import {
  navigateToNetworkLink,
  shouldConfirmNetworkSwitch,
  type NetworkLink,
} from "./networkSwitcher";

export interface UseNetworkSwitchResult {
  /** Link awaiting confirmation in the `NetworkSwitchDialog`; `null` when closed. */
  pendingLink: NetworkLink | null;
  /** Navigates immediately, or opens the confirm dialog when required. */
  requestSwitch: (link: NetworkLink) => void;
  confirmSwitch: () => void;
  cancelSwitch: () => void;
}

export function useNetworkSwitch(): UseNetworkSwitchResult {
  const [pendingLink, setPendingLink] = useState<NetworkLink | null>(null);

  const requestSwitch = useCallback((link: NetworkLink) => {
    if (shouldConfirmNetworkSwitch(link)) {
      setPendingLink(link);
    } else {
      navigateToNetworkLink(link);
    }
  }, []);

  const confirmSwitch = useCallback(() => {
    if (pendingLink) navigateToNetworkLink(pendingLink);
  }, [pendingLink]);

  const cancelSwitch = useCallback(() => setPendingLink(null), []);

  return { pendingLink, requestSwitch, confirmSwitch, cancelSwitch };
}
