/**
 * React Query hook — fetches staking PnL for the connected wallet from
 * `GET /v1/pnl`.
 *
 * The hook follows the active wallet view:
 *   - EVM view     -> `wallet=<0x...>&chain_id=<ENV.EVM_CHAIN_ID>`
 *   - Stellar view -> `wallet=<G...>&chain_id=<ENV.STELLAR_CHAIN_ID>`
 *
 * It is disabled until the active wallet is connected. Mock lookup is handled
 * by `apiFetch`, so `pipeline.mock.api.GET./v1/pnl` can bypass the network.
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

export interface VaultPnl {
  vault_address: string;
  shares_balance: string;
  avg_cost_basis: string;
  current_share_price: string;
  unrealized_pnl: string;
  realized_pnl: string;
  total_pnl: string;
}

export interface PnlResponse {
  wallet: string;
  positions: VaultPnl[];
  total_unrealized_pnl: string;
  total_realized_pnl: string;
  total_pnl: string;
  avg_apy?: string | null;
}

export interface UsePnlResult {
  data: PnlResponse | undefined;
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

export function usePnl(): UsePnlResult {
  const { kind } = useWalletView();
  const { address: evmAddress, isConnected: isEvmConnected } = useEvmWallet();
  const { address: stellarAddress, isConnected: isStellarConnected } =
    useStellarWallet();

  const isStellar = kind === "stellar";
  const address = isStellar ? stellarAddress : evmAddress;
  const isConnected = isStellar ? isStellarConnected : isEvmConnected;
  const chainId = isStellar ? ENV.STELLAR_CHAIN_ID : ENV.EVM_CHAIN_ID;

  const mockVer = useSyncExternalStore(
    subscribeMockVersion,
    getMockVersion,
    getMockVersion,
  );

  const query = useQuery<PnlResponse, Error>({
    queryKey: ["pnl", kind, address, chainId, mockVer],
    queryFn: () => {
      const params = new URLSearchParams({
        wallet: address ?? "",
        chain_id: String(chainId),
      });
      return apiFetch<PnlResponse>(`/v1/pnl?${params.toString()}`);
    },
    enabled: isConnected && !!address,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}
