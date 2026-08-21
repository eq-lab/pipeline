/**
 * Fetches the wallet's dense sPLUSD history from `GET /v1/positions/history`.
 * spec: docs/frontend/dashboard-components.md#portfolioplaceholdercard.
 */
import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { ENV } from "@/lib/env";
import {
  subscribeMock,
  useEvmWallet,
  useStellarWallet,
  useWalletView,
} from "@/wallet";
import { apiFetch } from "./client";

export interface PositionHistoryItem {
  timestamp: string;
  shares_balance: string;
  avg_cost_basis: string;
  cumulative_realized_pnl: string;
}

export interface PositionHistoryResponse {
  wallet: string;
  vault_address?: string | null;
  interval: string;
  history: PositionHistoryItem[];
}

export type HistoryInterval = "hourly" | "daily" | "weekly";

export interface PositionHistoryWindow {
  days: number;
  interval: HistoryInterval;
}

export const PERIOD_WINDOWS: Record<string, PositionHistoryWindow> = {
  "7d": { days: 7, interval: "hourly" },
  "1m": { days: 30, interval: "daily" },
  "3m": { days: 90, interval: "daily" },
  "1y": { days: 365, interval: "daily" },
};

export const ALL_INTERVAL_LADDER: readonly HistoryInterval[] = [
  "hourly",
  "daily",
  "weekly",
];

const resolvedAllRung = new Map<string, number>();

function isSampleCapError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /max \d+ samples|coarser .?interval.?/i.test(error.message)
  );
}

function fetchHistory(
  address: string,
  chainId: number,
  interval: HistoryInterval,
  days?: number,
): Promise<PositionHistoryResponse> {
  const params = new URLSearchParams({
    wallet: address,
    chain_id: String(chainId),
    interval,
  });
  if (days !== undefined) params.set("days", String(days));
  return apiFetch<PositionHistoryResponse>(
    `/v1/positions/history?${params.toString()}`,
  );
}

async function fetchAllHistory(
  address: string,
  chainId: number,
): Promise<PositionHistoryResponse> {
  const key = `${chainId}:${address}`;
  const start = resolvedAllRung.get(key) ?? 0;
  for (let rung = start; rung < ALL_INTERVAL_LADDER.length; rung++) {
    try {
      const response = await fetchHistory(
        address,
        chainId,
        ALL_INTERVAL_LADDER[rung]!,
      );
      resolvedAllRung.set(key, rung);
      return response;
    } catch (error) {
      if (isSampleCapError(error) && rung < ALL_INTERVAL_LADDER.length - 1) {
        resolvedAllRung.set(key, rung + 1);
        continue;
      }
      throw error;
    }
  }
  throw new Error("positions history: no interval fits the sample cap");
}

export interface UsePositionsHistoryResult {
  data: PositionHistoryResponse | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

let mockVersion = 0;

function getMockVersion() {
  return mockVersion;
}

function subscribeMockVersion(listener: () => void) {
  return subscribeMock("pipeline.mock.api", () => {
    mockVersion += 1;
    listener();
  });
}

export function usePositionsHistory(
  periodId: string,
): UsePositionsHistoryResult {
  const { kind } = useWalletView();
  const { address: evmAddress, isConnected: isEvmConnected } = useEvmWallet();
  const { address: stellarAddress, isConnected: isStellarConnected } =
    useStellarWallet();

  const isStellar = kind === "stellar";
  const address = isStellar ? stellarAddress : evmAddress;
  const isConnected = isStellar ? isStellarConnected : isEvmConnected;
  const chainId = isStellar ? ENV.STELLAR_CHAIN_ID : ENV.EVM_CHAIN_ID;
  const window = PERIOD_WINDOWS[periodId];

  const mockVer = useSyncExternalStore(
    subscribeMockVersion,
    getMockVersion,
    getMockVersion,
  );

  const query = useQuery<PositionHistoryResponse, Error>({
    queryKey: [
      "positionsHistory",
      kind,
      address,
      chainId,
      window ? window.days : "all-auto",
      window ? window.interval : "all-auto",
      mockVer,
    ],
    queryFn: () =>
      window
        ? fetchHistory(address ?? "", chainId, window.interval, window.days)
        : fetchAllHistory(address ?? "", chainId),
    enabled: isConnected && !!address,
    refetchInterval: 30_000,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}
