// spec: docs/frontend/wallet-flows.md#network-switcher-cross-deployment-links
// (cross-deployment link switcher design, issue #1032).
import {
  networkIdFromPassphrase,
  parseNetworkLinks,
  navigateToNetworkLink,
} from "@pipeline/wallet-connect";
import type { NetworkIdentity, NetworkLink } from "@pipeline/wallet-connect";
import { ENV } from "@/lib/env";

export type { NetworkIdentity, NetworkLink };
export { navigateToNetworkLink };

export interface NetworkSwitcherState {
  /** This deployment's own network, derived from its Stellar passphrase config. */
  currentNetwork: NetworkIdentity;
  /** Sibling deployments from `VITE_NETWORK_LINKS`, excluding the current network. */
  otherNetworks: NetworkLink[];
}

/**
 * Derives the network-switcher display state from this app's env config.
 * Shared by `TopBar` (always-visible static label) and `useAccountDropdown`
 * (the menu's switch-network rows) so both read the same current-network /
 * sibling-links derivation.
 */
export function getNetworkSwitcherState(): NetworkSwitcherState {
  const currentNetwork = networkIdFromPassphrase(
    ENV.STELLAR_NETWORK_PASSPHRASE,
  );
  const otherNetworks = parseNetworkLinks(ENV.NETWORK_LINKS).filter(
    (link) => link.id !== currentNetwork.id,
  );
  return { currentNetwork, otherNetworks };
}
