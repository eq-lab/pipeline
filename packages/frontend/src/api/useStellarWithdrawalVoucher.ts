/**
 * React Query hook — fetches a withdrawal voucher (verifier signature) from the
 * Pipeline API for a Stellar withdrawal request.
 *
 * Mirrors `useWithdrawalVoucher.ts` but uses `useStellarWallet()` for the wallet
 * query parameter (Stellar address `G…`), appends `&chain_id=99000001` so the
 * API dispatches to the ed25519 Stellar verifier path, and adds `signatureBytes`
 * derived by hex-decoding the `signature` field (ed25519, 64 bytes → 128 hex chars).
 *
 * The hook polls `GET /v1/withdrawals/{request_id}/voucher?wallet=<G…>&chain_id=99000001`
 * every 3 s until the verifier signature is available.
 *
 * Mock layer
 * ----------
 * Two mock keys are checked (most-specific first):
 *   1. `pipeline.mock.api.GET./v1/withdrawals/<requestId>/voucher?wallet=<addr>`
 *   2. `pipeline.mock.api.GET./v1/withdrawals/<requestId>/voucher`
 *
 * See `src/api/README.md` for the full mock-key schema and DevTools snippets.
 */

import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { useStellarWallet } from "@/wallet";
import { subscribeMock } from "@/wallet";
import { apiFetch } from "./client";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Stellar chain_id used for the voucher `chain_id` query param. */
const STELLAR_CHAIN_ID = "99000001";

export interface StellarWithdrawalVoucherResponse {
  request_id: string;
  amount: string;
  user: string;
  /**
   * Verifier signature — hex-encoded ed25519 (64 bytes → 128 hex chars).
   * Pass the decoded `signatureBytes` to `useStellarClaimWithdrawal.write()`.
   */
  signature: string;
}

export type StellarWithdrawalVoucherStatus = "idle" | "pending" | "ready" | "failed";

export interface UseStellarWithdrawalVoucherResult {
  data: StellarWithdrawalVoucherResponse | undefined;
  /** Hex-decoded bytes of `data.signature`. `undefined` until the voucher is ready. */
  signatureBytes: Uint8Array | undefined;
  status: StellarWithdrawalVoucherStatus;
  error: Error | null;
  refetch: () => void;
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

/**
 * Decodes a hex string into a `Uint8Array`.
 * Returns `undefined` for non-hex or odd-length strings.
 */
function hexToBytes(hex: string): Uint8Array | undefined {
  if (hex.length % 2 !== 0) return undefined;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    const byte = parseInt(hex.slice(i, i + 2), 16);
    if (isNaN(byte)) return undefined;
    bytes[i / 2] = byte;
  }
  return bytes;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Returns the withdrawal voucher for the given Stellar request ID.
 *
 * - Disabled when `requestId` is `undefined` or the Stellar wallet is disconnected.
 * - Polls until the voucher is ready (verifier may have latency).
 * - `signatureBytes` is a hex-decoded `Uint8Array` of `data.signature` (64 bytes).
 * - Appends `&chain_id=99000001` to the API URL so the verifier dispatches to
 *   the Stellar ed25519 signing path.
 *
 * @param requestId  The withdrawal request ID (bigint or string). Pass `undefined`
 *                   to keep the hook in the idle/disabled state.
 */
export function useStellarWithdrawalVoucher(
  requestId: bigint | string | undefined,
): UseStellarWithdrawalVoucherResult {
  const { address, isConnected } = useStellarWallet();

  // Subscribe to mock-key changes — version is included in queryKey to force
  // React Query to issue a fresh fetch when mock data is written.
  const mockVer = useSyncExternalStore(
    subscribeMockVersion,
    getMockVersion,
    getMockVersion,
  );

  const requestIdStr = requestId !== undefined ? String(requestId) : undefined;
  const enabled = !!requestIdStr && isConnected && !!address;

  const query = useQuery<StellarWithdrawalVoucherResponse, Error>({
    queryKey: ["stellar-withdrawal-voucher", requestIdStr, address, mockVer],
    queryFn: () =>
      apiFetch<StellarWithdrawalVoucherResponse>(
        `/v1/withdrawals/${requestIdStr}/voucher?wallet=${address ?? ""}&chain_id=${STELLAR_CHAIN_ID}`,
      ),
    enabled,
    // Poll every 3 seconds while no signature yet.
    refetchInterval: (q) => {
      if (q.state.data?.signature) return false;
      return 3000;
    },
    // Retry on retriable errors (404 = not yet visible, 403 = not yet allowed).
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
  let status: StellarWithdrawalVoucherStatus;
  if (!enabled) {
    status = "idle";
  } else if (query.data?.signature) {
    status = "ready";
  } else if (query.error && !query.isFetching) {
    status = "failed";
  } else {
    status = "pending";
  }

  // Decode signatureBytes from hex.
  const signatureBytes =
    query.data?.signature ? hexToBytes(query.data.signature) : undefined;

  return {
    data: query.data,
    signatureBytes,
    status,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}
