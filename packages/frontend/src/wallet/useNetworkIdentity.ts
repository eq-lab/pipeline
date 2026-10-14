// spec: docs/frontend/wallet-flows.md#network-switcher-cross-deployment-links
import {
  getNetworkSwitcherState,
  isMainnetNetwork,
  type NetworkSwitcherState,
} from "./networkSwitcher";
import { useActiveChain } from "./useActiveChain";

export function useNetworkSwitcherState(): NetworkSwitcherState {
  const { kind } = useActiveChain();
  return getNetworkSwitcherState(kind);
}

export function useIsMainnetNetwork(): boolean {
  const { kind } = useActiveChain();
  return isMainnetNetwork(kind);
}
