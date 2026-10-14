// spec: docs/frontend/dashboard-components.md#usedashboardchain
import { useActiveChain, type UseActiveChainResult } from "@/wallet";

export function useDashboardChain(): UseActiveChainResult {
  return useActiveChain();
}
