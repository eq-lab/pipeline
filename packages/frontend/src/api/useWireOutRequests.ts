// spec: docs/product-specs/withdrawals.md#bank-wire-withdrawals-lp-app
import { useQuery } from "@tanstack/react-query";
import {
  isWireOutMinterConfigured,
  useEvmWallet,
  useStellarWallet,
  useWalletView,
} from "@/wallet";
import { ENV } from "@/lib/env";
import { apiFetch } from "./client";

const POLL_MS = 30_000;

export interface AuditLogItem {
  chain_id: number;
  timestamp: string;
  event_name: string;
  details: Record<string, unknown>;
}

export interface AuditLogResponse {
  items: AuditLogItem[];
}

export function getAuditLog(chainId: number): Promise<AuditLogResponse> {
  return apiFetch<AuditLogResponse>(`/v1/audit-log?chain_id=${chainId}`);
}

export interface WireOutRequestItem {
  id: string;
  timestamp: string;
}

export interface UseWireOutRequestsResult {
  items: WireOutRequestItem[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

function sameWallet(
  kind: "evm" | "stellar",
  lp: unknown,
  address: string,
): boolean {
  if (typeof lp !== "string") return false;
  return kind === "evm"
    ? lp.toLowerCase() === address.toLowerCase()
    : lp === address;
}

export function useWireOutRequests(): UseWireOutRequestsResult {
  const { kind } = useWalletView();
  const { address: evmAddress, isConnected: isEvmConnected } = useEvmWallet();
  const { address: stellarAddress, isConnected: isStellarConnected } =
    useStellarWallet();

  const address = kind === "stellar" ? stellarAddress : evmAddress;
  const isConnected = kind === "stellar" ? isStellarConnected : isEvmConnected;
  const chainId = kind === "stellar" ? ENV.STELLAR_CHAIN_ID : ENV.EVM_CHAIN_ID;

  const query = useQuery<WireOutRequestItem[], Error>({
    queryKey: ["wire-out-requests", kind, address, chainId],
    queryFn: async () => {
      const { items } = await getAuditLog(chainId);
      const mine: WireOutRequestItem[] = [];
      for (const item of items) {
        if (item.event_name !== "WireOutRequested") continue;
        if (!sameWallet(kind, item.details.lp, address ?? "")) continue;
        if (item.details.id === undefined || item.details.id === null) continue;
        mine.push({ id: String(item.details.id), timestamp: item.timestamp });
      }
      return mine;
    },
    enabled: isConnected && !!address && isWireOutMinterConfigured(kind),
    staleTime: POLL_MS,
    refetchInterval: POLL_MS,
  });

  return {
    items: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}
