// spec: docs/frontend/dashboard-components.md#activity-feed
import { useRequests } from "@/api";
import type {
  RequestItem,
  RequestsResponse,
  UseRequestsResult,
  WireInItem,
  WireOutItem,
} from "@/api";

export type ActivityFeedItem =
  | { kind: "request"; item: RequestItem }
  | { kind: "wireIn"; item: WireInItem }
  | { kind: "wireOut"; item: WireOutItem };

export interface UseActivityFeedOptions {
  limit?: number;
}

export interface UseActivityFeedResult {
  items: ActivityFeedItem[];
  requests: UseRequestsResult;
}

export function activityTime(entry: ActivityFeedItem): string | undefined {
  if (entry.kind === "request") return entry.item.created_at;
  if (entry.kind === "wireIn") {
    return entry.item.assigned_at ?? entry.item.recorded_at;
  }
  return entry.item.requested_at;
}

function timeOf(entry: ActivityFeedItem): number {
  const iso = activityTime(entry);
  const t = iso === undefined ? NaN : Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

export function mergeActivityFeed(
  data: RequestsResponse | undefined,
): ActivityFeedItem[] {
  if (!data) return [];
  const entries: ActivityFeedItem[] = [
    ...(data.requests ?? []).map((item) => ({
      kind: "request" as const,
      item,
    })),
    ...(data.wire_ins ?? []).map((item) => ({ kind: "wireIn" as const, item })),
    ...(data.wire_outs ?? []).map((item) => ({
      kind: "wireOut" as const,
      item,
    })),
  ];
  return entries.sort((a, b) => timeOf(b) - timeOf(a));
}

export function useActivityFeed({
  limit,
}: UseActivityFeedOptions = {}): UseActivityFeedResult {
  const requests = useRequests();
  const merged = mergeActivityFeed(requests.data);
  const items = limit === undefined ? merged : merged.slice(0, limit);
  return { items, requests };
}
