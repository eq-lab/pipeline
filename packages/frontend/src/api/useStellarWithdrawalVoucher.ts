// spec: docs/product-specs/withdrawals.md#voucher-validity
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { useStellarWallet } from "@/wallet";
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

export interface StellarWithdrawalVoucherResponse {
  request_id: string;
  amount: string;
  user: string;
  signature: string;
  deadline?: string;
}

export type StellarWithdrawalVoucherStatus =
  | "idle"
  | "pending"
  | "ready"
  | "failed";

export interface UseStellarWithdrawalVoucherResult {
  data: StellarWithdrawalVoucherResponse | undefined;
  signatureBytes: Uint8Array | undefined;
  status: StellarWithdrawalVoucherStatus;
  error: Error | null;
  refetch: () => void;
  invalidate: () => void;
}

// ── Mock-version external store ────────────────────────────────────────────────

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

// ── Hex decode helper ─────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array | undefined {
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (normalized.length % 2 !== 0) return undefined;
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < normalized.length; i += 2) {
    const byte = parseInt(normalized.slice(i, i + 2), 16);
    if (isNaN(byte)) return undefined;
    bytes[i / 2] = byte;
  }
  return bytes;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useStellarWithdrawalVoucher(
  requestId: bigint | string | undefined,
): UseStellarWithdrawalVoucherResult {
  const { address, isConnected } = useStellarWallet();

  const mockVer = useSyncExternalStore(
    subscribeMockVersion,
    getMockVersion,
    getMockVersion,
  );

  const requestIdStr = requestId !== undefined ? String(requestId) : undefined;
  const enabled = !!requestIdStr && isConnected && !!address;
  const chainId = ENV.STELLAR_CHAIN_ID;

  const queryClient = useQueryClient();
  const query = useQuery<StellarWithdrawalVoucherResponse, Error>({
    queryKey: [
      "stellar-withdrawal-voucher",
      requestIdStr,
      address,
      chainId,
      mockVer,
    ],
    queryFn: () =>
      apiFetch<StellarWithdrawalVoucherResponse>(
        `/v1/withdrawals/${requestIdStr}/voucher?wallet=${address ?? ""}&chain_id=${chainId}`,
      ),
    enabled,
    refetchInterval: (q) =>
      voucherRefetchInterval(q.state.data, q.state.error, Date.now()),
    retry: (failureCount, error) =>
      isRetriableVoucherError(error) && failureCount < VOUCHER_RETRY_LIMIT,
    retryDelay: 3000,
  });

  const deadlinePassed = useVoucherExpired(query.data?.deadline);
  const expired = !!query.data?.signature && deadlinePassed;

  let status: StellarWithdrawalVoucherStatus;
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

  const signatureBytes =
    query.data?.signature && !expired
      ? hexToBytes(query.data.signature)
      : undefined;

  return {
    data: expired ? undefined : query.data,
    signatureBytes,
    status,
    error: query.error,
    refetch: () => void query.refetch(),
    invalidate: () =>
      void queryClient.resetQueries({
        queryKey: [
          "stellar-withdrawal-voucher",
          requestIdStr,
          address,
          chainId,
        ],
      }),
  };
}
