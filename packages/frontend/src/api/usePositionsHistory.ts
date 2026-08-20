/**
 * React Query hook — fetches the connected wallet's dense sPLUSD position
 * history from `GET /v1/positions/history` (#1116/#1135), period-parameterized.
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

export interface PositionHistoryWindow {
  days?: number;
  interval: "hourly" | "daily" | "weekly";
}

export const PERIOD_WINDOWS: Record<string, PositionHistoryWindow> = {
  "7d": { days: 7, interval: "hourly" },
  "1m": { days: 30, interval: "daily" },
  "3m": { days: 90, interval: "daily" },
  "1y": { days: 365, interval: "daily" },
  all: { interval: "weekly" },
};

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
  const window = PERIOD_WINDOWS[periodId] ?? PERIOD_WINDOWS["all"]!;

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
      window.days ?? "all",
      window.interval,
      mockVer,
    ],
    queryFn: () => {
      const params = new URLSearchParams({
        wallet: address ?? "",
        chain_id: String(chainId),
        interval: window.interval,
      });
      if (window.days !== undefined) params.set("days", String(window.days));
      return apiFetch<PositionHistoryResponse>(
        `/v1/positions/history?${params.toString()}`,
      );
    },
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
