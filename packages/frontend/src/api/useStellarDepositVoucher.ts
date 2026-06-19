/**
 * React Query hook — fetches a deposit voucher (verifier signature) from the
 * Pipeline API for a Stellar deposit request.
 *
 * Mirrors `useDepositVoucher.ts` but uses `useStellarWallet()` for the wallet
 * query parameter (Stellar address `G…`) and adds `signatureBytes` derived by
 * hex-decoding the `signature` field (ed25519, 64 bytes → 0x-prefixed hex).
 *
 * The hook polls
 * `GET /v1/deposits/{request_id}/voucher?wallet=<G…>&chain_id=<chain_id>`
 * every 3 s until the verifier signature is available.
 *
 * Mock layer
 * ----------
 * Two mock keys are checked (most-specific first):
 *   1. `pipeline.mock.api.GET./v1/deposits/<requestId>/voucher?wallet=<addr>&chain_id=<id>`
 *   2. `pipeline.mock.api.GET./v1/deposits/<requestId>/voucher`
 *
 * See `src/api/README.md` for the full mock-key schema and DevTools snippets.
 */

import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { useStellarWallet } from "@/wallet";
import { subscribeMock } from "@/wallet";
import { ENV } from "@/lib/env";
import { apiFetch } from "./client";
import type { VoucherResponse, VoucherStatus } from "./useDepositVoucher";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Signature is hex-encoded ed25519 (64 bytes → 0x-prefixed hex). */
export type StellarVoucherResponse = VoucherResponse;

export interface UseStellarDepositVoucherResult {
  data: StellarVoucherResponse | undefined;
  /** Hex-decoded bytes of `data.signature`. `undefined` until the voucher is ready. */
  signatureBytes: Uint8Array | undefined;
  status: VoucherStatus;
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

/**
 * Returns the deposit voucher for the given Stellar request ID.
 *
 * - Disabled when `requestId` is `undefined` or the Stellar wallet is disconnected.
 * - Polls until the voucher is ready (verifier may have latency).
 * - `signatureBytes` is a hex-decoded `Uint8Array` of `data.signature` (64 bytes).
 *
 * @param requestId  The deposit request ID (bigint or string). Pass `undefined`
 *                   to keep the hook in the idle/disabled state.
 */
export function useStellarDepositVoucher(
  requestId: bigint | string | undefined,
): UseStellarDepositVoucherResult {
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
  const chainId = ENV.STELLAR_CHAIN_ID;

  const query = useQuery<StellarVoucherResponse, Error>({
    queryKey: [
      "stellar-deposit-voucher",
      requestIdStr,
      address,
      chainId,
      mockVer,
    ],
    queryFn: () =>
      apiFetch<StellarVoucherResponse>(
        `/v1/deposits/${requestIdStr}/voucher?wallet=${address ?? ""}&chain_id=${chainId}`,
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
  let status: VoucherStatus;
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
  const signatureBytes = query.data?.signature
    ? hexToBytes(query.data.signature)
    : undefined;

  return {
    data: query.data,
    signatureBytes,
    status,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}
