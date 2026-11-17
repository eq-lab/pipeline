// spec: docs/frontend/trustee-flows.md#trustee-sidebar-figma-node-41168855-aside
import { useAttentionCounts } from "@/api/useAttentionCounts";
import type { AttentionCountsResponse } from "@/api/useAttentionCounts";
import { useSessionState } from "@/auth/sessionStore";

export type NavBadgeCounts = Partial<Record<string, number>>;

function served(value: unknown): number | undefined {
  return typeof value === "number" && value > 0 ? value : undefined;
}

export function navBadgeCounts(
  data: AttentionCountsResponse | undefined,
  chainId: number | undefined,
): NavBadgeCounts {
  if (!data) return {};
  const chain =
    chainId === undefined
      ? undefined
      : (data.chains ?? []).find((c) => c?.chain_id === chainId);
  const entries: Array<[string, number | undefined]> = [
    ["/origination", served(data.origination?.count)],
    ["/loans", served(data.loans?.count)],
    ["/cash-management", served(chain?.cash_management?.count)],
  ];
  const out: NavBadgeCounts = {};
  for (const [path, count] of entries) {
    if (count !== undefined) out[path] = count;
  }
  return out;
}

export function useNavBadgeCounts(): NavBadgeCounts {
  const query = useAttentionCounts();
  const { chainId } = useSessionState();
  if (query.error) return {};
  return navBadgeCounts(query.data, chainId);
}
