// spec: docs/frontend/wallet-flows.md#network-switcher-cross-deployment-links
import {
  networkIdFromPassphrase,
  networkIdFromEvmChainId,
  parseNetworkLinks,
  navigateToNetworkLink,
  shouldConfirmNetworkSwitch,
} from "@pipeline/wallet-connect";
import type { NetworkIdentity, NetworkLink } from "@pipeline/wallet-connect";
import { ENV } from "@/lib/env";
import type { WalletViewKind } from "./WalletViewContext";

export type { NetworkIdentity, NetworkLink };
export { navigateToNetworkLink, shouldConfirmNetworkSwitch };

export interface NetworkSwitcherState {
  currentNetwork: NetworkIdentity;
  otherNetworks: NetworkLink[];
}

export function currentNetworkFor(kind: WalletViewKind): NetworkIdentity {
  return kind === "evm"
    ? networkIdFromEvmChainId(ENV.EVM_CHAIN_ID)
    : networkIdFromPassphrase(ENV.STELLAR_NETWORK_PASSPHRASE);
}

export function getNetworkSwitcherState(
  kind: WalletViewKind,
): NetworkSwitcherState {
  const currentNetwork = currentNetworkFor(kind);
  const otherNetworks = parseNetworkLinks(ENV.NETWORK_LINKS).filter(
    (link) => link.id !== currentNetwork.id,
  );
  return { currentNetwork, otherNetworks };
}

export function isMainnetNetwork(kind: WalletViewKind): boolean {
  return currentNetworkFor(kind).id === "mainnet";
}
