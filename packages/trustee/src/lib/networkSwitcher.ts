// spec: docs/frontend/wallet-flows.md#network-switcher-cross-deployment-links
// (cross-deployment link switcher design, issue #1032). Trustee-local glue
// mirroring `packages/frontend/src/wallet/networkSwitcher.ts` — this app does
// not depend on `@pipeline/frontend` (epic #775 keeps the two apps separate),
// so the thin ENV + wallet-connect composition is duplicated per-app while
// the actual parsing/identity/navigate logic stays shared in
// `@pipeline/wallet-connect`.
import {
  networkIdFromPassphrase,
  parseNetworkLinks,
  navigateToNetworkLink,
} from "@pipeline/wallet-connect";
import type { NetworkIdentity, NetworkLink } from "@pipeline/wallet-connect";
import { ENV } from "./env";

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
 * Shared by `TrusteeSidebar`'s always-visible static label and its
 * `⋯` AccountMenu popover's switch-network rows.
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
