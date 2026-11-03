// spec: docs/product-specs/withdrawals.md#voucher-validity
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { useEvmWallet } from "@/wallet";
import { subscribeMock } from "@/wallet";
import { ENV } from "@/lib/env";
import { apiFetch } from "./client";
import {
  isRetriableVoucherError,
  useVoucherExpired,
  VOUCHER_RETRY_LIMIT,
  voucherRefetchInterval,
} from "./voucherRetry";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WithdrawalVoucherResponse {
  request_id: string;
  amount: string;
  user: string;
  signature: string;
  deadline?: string;
}

export type WithdrawalVoucherStatus = "idle" | "pending" | "ready" | "failed";

export interface UseWithdrawalVoucherResult {
  data: WithdrawalVoucherResponse | undefined;
  status: WithdrawalVoucherStatus;
  expired: boolean;
  error: Error | null;
  refetch: () => void;
  invalidate: () => void;
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

export function useWithdrawalVoucher(
  requestId: string | undefined,
): UseWithdrawalVoucherResult {
  const { address, isConnected } = useEvmWallet();

  const mockVer = useSyncExternalStore(
    subscribeMockVersion,
    getMockVersion,
    getMockVersion,
  );

  const enabled = !!requestId && isConnected && !!address;
  const chainId = ENV.EVM_CHAIN_ID;

  const queryClient = useQueryClient();
  const query = useQuery<WithdrawalVoucherResponse, Error>({
    queryKey: ["withdrawal-voucher", requestId, address, chainId, mockVer],
    queryFn: () =>
      apiFetch<WithdrawalVoucherResponse>(
        `/v1/withdrawals/${requestId}/voucher?wallet=${address ?? ""}&chain_id=${chainId}`,
      ),
    enabled,
    refetchInterval: (query) =>
      voucherRefetchInterval(query.state.data, query.state.error, Date.now()),
    retry: (failureCount, error) =>
      isRetriableVoucherError(error) && failureCount < VOUCHER_RETRY_LIMIT,
    retryDelay: 3000,
  });

  const deadlinePassed = useVoucherExpired(query.data?.deadline);
  const expired = !!query.data?.signature && deadlinePassed;

  let status: WithdrawalVoucherStatus;
  if (!enabled) {
    status = "idle";
  } else if (expired) {
    status = "pending";
  } else if (query.data?.signature) {
    status = "ready";
  } else if (query.error && !query.isFetching) {
    status = "failed";
  } else {
    status = "pending";
  }

  return {
    data: expired ? undefined : query.data,
    status,
    expired: false,
    error: query.error,
    refetch: () => void query.refetch(),
    invalidate: () =>
      void queryClient.resetQueries({
        queryKey: ["withdrawal-voucher", requestId, address, chainId],
      }),
  };
}
