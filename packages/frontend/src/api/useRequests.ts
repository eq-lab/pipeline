// spec: docs/frontend/wallet-flows.md#activity-refresh-after-a-confirmed-action
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import { subscribeMock } from "@/wallet";
import { apiFetch } from "./client";
import {
  ACTIVITY_POLL_MS,
  getExpectations,
  openExpectationsFor,
  settleExpectations,
  subscribeExpectations,
  useActiveRequestsScope,
} from "./activityRefresh";

// ── Types ─────────────────────────────────────────────────────────────────────

export type RequestStatus =
  | "PendingVerification"
  | "PendingClaim"
  | "Completed"
  | "VerificationFailed";

export type RequestType = "Deposit" | "Withdraw" | "Stake" | "Unstake";

export interface RequestItem {
  type: RequestType;
  chain_id: number;
  request_id?: string;
  amount: string;
  assets?: string;
  shares?: string;
  status: RequestStatus;
  created_at: string;
}

export interface RequestsResponse {
  requests: RequestItem[];
}

// ── Mock-version external store ────────────────────────────────────────────────

let mockVersion = 0;
const mockListeners = new Set<() => void>();

function getMockVersion() {
  return mockVersion;
}

function subscribeMockVersion(listener: () => void) {
  return subscribeMock("pipeline.mock.api", () => {
    mockVersion += 1;
    listener();
    for (const l of mockListeners) {
      if (l !== listener) l();
    }
  });
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UseRequestsOptions {
  refetchInterval?:
    | number
    | ((data: RequestsResponse | undefined) => number | false);
}

export interface UseRequestsResult {
  data: RequestsResponse | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useRequests(
  options: UseRequestsOptions = {},
): UseRequestsResult {
  const queryClient = useQueryClient();
  const { kind, address, isConnected, chainId } = useActiveRequestsScope();

  const mockVer = useSyncExternalStore(
    subscribeMockVersion,
    getMockVersion,
    getMockVersion,
  );
  const expectations = useSyncExternalStore(
    subscribeExpectations,
    getExpectations,
    getExpectations,
  );

  const interval = options.refetchInterval;

  const query = useQuery<RequestsResponse, Error>({
    queryKey: ["requests", kind, address, chainId, mockVer],
    queryFn: () =>
      apiFetch<RequestsResponse>(
        `/v1/requests?wallet=${address ?? ""}&chain_id=${chainId}`,
      ),
    enabled: isConnected && !!address,
    refetchInterval: (q) => {
      const data = q.state.data;
      const caller = typeof interval === "function" ? interval(data) : interval;
      const open = openExpectationsFor(
        expectations,
        address,
        chainId,
        data,
        Date.now(),
      );
      if (open.length === 0) return caller ?? false;
      return Math.min(ACTIVITY_POLL_MS, caller || Infinity);
    },
  });

  const { data, dataUpdatedAt } = query;
  useEffect(() => {
    if (!dataUpdatedAt) return;
    if (settleExpectations(data, address, chainId, Date.now())) {
      void queryClient.invalidateQueries({ queryKey: ["pnl"] });
      void queryClient.invalidateQueries({ queryKey: ["positionsHistory"] });
    }
  }, [data, dataUpdatedAt, address, chainId, queryClient]);

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}
