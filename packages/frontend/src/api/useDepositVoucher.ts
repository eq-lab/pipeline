/**
 * React Query hook — fetches a deposit voucher (verifier signature) from the
 * Pipeline API (`GET /v1/deposits/{request_id}/voucher?wallet=<address>`).
 *
 * The voucher contains the `signature` needed to call `useClaim.write()`.
 * The hook is disabled when `requestId` is `undefined` or the wallet is
 * disconnected — it returns `{ status: "idle" }` in those cases.
 *
 * Mock layer
 * ----------
 * The hook is reactive to changes in `pipeline.mock.api.*` localStorage keys.
 * Two mock keys are checked (most-specific first):
 *
 *   1. `pipeline.mock.api.GET./v1/deposits/<requestId>/voucher?wallet=<addr>`
 *   2. `pipeline.mock.api.GET./v1/deposits/<requestId>/voucher`
 *
 * See `src/api/README.md` for the full mock-key schema and DevTools snippets.
 */
import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { useEvmWallet } from "@/wallet";
import { subscribeMock } from "@/wallet";
import { apiFetch } from "./client";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VoucherResponse {
  request_id: string;
  amount: string;
  user: string;
  /** Verifier signature — passed directly to `useClaim.write()`. */
  signature: string;
}

export type VoucherStatus = "idle" | "pending" | "ready" | "failed";

export interface UseDepositVoucherResult {
  data: VoucherResponse | undefined;
  status: VoucherStatus;
  error: Error | null;
  refetch: () => void;
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

/**
 * Returns the deposit voucher for the given request ID.
 *
 * - Disabled when `requestId` is `undefined` or the wallet is disconnected.
 * - Polls until the voucher is ready (verifier may have latency).
 * - The `status` field conveys: `"idle"` | `"pending"` | `"ready"` | `"failed"`.
 *
 * @param requestId  The deposit request ID (string, e.g. "42"). Pass `undefined`
 *                   to keep the hook in the idle/disabled state.
 */
export function useDepositVoucher(
  requestId: string | undefined,
): UseDepositVoucherResult {
  const { address, isConnected } = useEvmWallet();

  // Subscribe to mock-key changes — version is included in queryKey to force
  // React Query to issue a fresh fetch when mock data is written.
  const mockVer = useSyncExternalStore(
    subscribeMockVersion,
    getMockVersion,
    getMockVersion,
  );

  const enabled = !!requestId && isConnected && !!address;

  const query = useQuery<VoucherResponse, Error>({
    queryKey: ["deposit-voucher", requestId, address, mockVer],
    queryFn: () =>
      apiFetch<VoucherResponse>(
        `/v1/deposits/${requestId}/voucher?wallet=${address ?? ""}`,
      ),
    enabled,
    // Poll every 3 seconds while no data yet (verifier has latency).
    // Once data is present the refetchInterval callback returns false to stop.
    refetchInterval: (query) => {
      if (query.state.data?.signature) return false;
      return 3000;
    },
    // Keep retrying on retriable errors (404 = not yet visible, 403 = not yet allowed).
    retry: (failureCount, error) => {
      const msg = error?.message ?? "";
      const isRetriable =
        msg.includes("Not Found") ||
        msg.includes("not found") ||
        msg.includes("Forbidden") ||
        msg.includes("forbidden") ||
        msg.includes("not yet");
      return isRetriable && failureCount < 20;
    },
    retryDelay: 3000,
  });

  // Derive status from query state.
  let status: VoucherStatus;
  if (!enabled) {
    status = "idle";
  } else if (query.data?.signature) {
    status = "ready";
  } else if (query.error && !query.isFetching) {
    // Non-retriable error (or exhausted retries).
    status = "failed";
  } else {
    status = "pending";
  }

  return {
    data: query.data,
    status,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}
