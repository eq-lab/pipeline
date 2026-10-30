// spec: docs/frontend/dashboard-components.md#recentactivitycard
import { useRequests, useWireOutRequests } from "@/api";
import type { RequestItem, UseRequestsResult } from "@/api";
import { useWalletView, useWireOuts } from "@/wallet";
import type { WireOutRead } from "@/wallet";

export type ActivityFeedItem =
  | { kind: "request"; item: RequestItem }
  | { kind: "wireOut"; id: string; timestamp: string };

export interface UseActivityFeedOptions {
  limit?: number;
  includeWireOuts?: boolean;
}

export interface UseActivityFeedResult {
  items: ActivityFeedItem[];
  wireOuts: Record<string, WireOutRead>;
  requests: UseRequestsResult;
}

function timeOf(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

export function mergeActivityFeed(
  requests: RequestItem[],
  wireOuts: Array<{ id: string; timestamp: string }>,
): ActivityFeedItem[] {
  const merged: ActivityFeedItem[] = [];
  let r = 0;
  let w = 0;
  while (r < requests.length || w < wireOuts.length) {
    const request = requests[r];
    const wireOut = wireOuts[w];
    const takeRequest =
      request !== undefined &&
      (wireOut === undefined ||
        timeOf(request.created_at) >= timeOf(wireOut.timestamp));
    if (takeRequest) {
      merged.push({ kind: "request", item: request });
      r += 1;
    } else if (wireOut !== undefined) {
      merged.push({
        kind: "wireOut",
        id: wireOut.id,
        timestamp: wireOut.timestamp,
      });
      w += 1;
    }
  }
  return merged;
}

export function useActivityFeed({
  limit,
  includeWireOuts = true,
}: UseActivityFeedOptions = {}): UseActivityFeedResult {
  const { kind } = useWalletView();
  const requests = useRequests();
  const { items: wireOutItems } = useWireOutRequests();

  const merged = mergeActivityFeed(
    requests.data?.requests ?? [],
    includeWireOuts ? wireOutItems : [],
  );
  const items = limit === undefined ? merged : merged.slice(0, limit);
  const wireOuts = useWireOuts(
    kind,
    items.flatMap((entry) => (entry.kind === "wireOut" ? [entry.id] : [])),
  );

  return { items, wireOuts, requests };
}
