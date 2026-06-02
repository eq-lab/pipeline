/**
 * `useBlendPosition` — read hook for the connected account's collateral
 * position in the Blend pool for a given reserve.
 *
 * Uses TanStack Query + mock fast-path. Mirrors `useStellarToken` conventions.
 *
 * Return shape:
 *   - `position`          — raw 7-decimal bigint (1 XLM = 10_000_000n), or
 *                           `undefined` when disconnected / loading.
 *   - `formattedPosition` — human-scaled decimal string (e.g. `"1.0000000"`),
 *                           or `undefined` when disconnected / loading.
 *   - `refetch`           — re-triggers the Soroban RPC read.
 *   - `isLoading`         — `true` while the first query is in-flight.
 *   - `error`             — `Error | null` from the underlying query.
 *
 * Mock layer:
 *   `pipeline.mock.wallet.stellar.blend.position` — raw bigint string (e.g.
 *   `"10000000"` = 1 XLM). When set, the hook returns the mock value without
 *   any Soroban RPC call.
 *
 * No-position / unfunded: returns `position === 0n`,
 *   `formattedPosition === "0.0000000"` — not an error.
 *
 * Decimals: Stellar reserves use 7 decimals; `formattedPosition` divides the
 * raw bigint by 1e7 and formats with 7 decimal places.
 */
import { useQuery } from "@tanstack/react-query";
import { useStellarWallet } from "./useStellarWallet";
import { loadBlendCollateral } from "./blendPool";
import { STELLAR_MOCK_KEYS } from "./mock";
import { readMock, useMock, parseBigInt } from "../evm/mock";
import { blendNetwork, blendPoolId, blendXlmId, sorobanRpcUrl } from "./chain";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UseBlendPositionResult {
  /**
   * Raw 7-decimal bigint collateral amount (1 XLM = 10_000_000n), or
   * `undefined` when disconnected or loading.
   */
  position: bigint | undefined;
  /**
   * Human-scaled decimal string with 7 decimal places (e.g. `"1.0000000"`),
   * or `undefined` when disconnected or loading.
   */
  formattedPosition: string | undefined;
  /** Re-triggers the Soroban RPC position read. */
  refetch: () => void;
  /** `true` while the first query is in-flight. */
  isLoading: boolean;
  /** Error from the Soroban RPC query, or `null`. */
  error: Error | null;
}

// ── Format helper ─────────────────────────────────────────────────────────────

/**
 * Scales a 7-decimal Stellar fixed-point bigint to a human-readable decimal
 * string with 7 decimal places.
 */
export function formatBlendPosition(raw: bigint): string {
  const whole = raw / 10_000_000n;
  const frac = raw % 10_000_000n;
  const fracStr = String(frac < 0n ? -frac : frac).padStart(7, "0");
  return `${String(whole)}.${fracStr}`;
}

// ── useBlendPosition ──────────────────────────────────────────────────────────

/**
 * Returns the connected account's supplied-collateral position in the Blend
 * pool for the given reserve.
 *
 * @param reserveId - Reserve asset address. Defaults to `blendXlmId` (XLM
 *   reserve) — the acceptance-test asset per the plan.
 */
export function useBlendPosition(reserveId?: string): UseBlendPositionResult {
  const { address, isConnected } = useStellarWallet();
  const effectiveReserveId = reserveId ?? blendXlmId;

  // ── Mock read (reactive) ──────────────────────────────────────────────────
  const mockPosition = useMock(STELLAR_MOCK_KEYS.blendPosition, parseBigInt);

  // ── Query function ────────────────────────────────────────────────────────

  const queryFn = async (): Promise<bigint> => {
    // Re-read mock at query time (covers non-reactive query re-runs).
    const mockVal = readMock(STELLAR_MOCK_KEYS.blendPosition, parseBigInt);
    if (mockVal !== undefined) {
      return mockVal;
    }

    if (!address) return 0n;

    return loadBlendCollateral({
      network: blendNetwork,
      poolId: blendPoolId,
      userAddress: address,
      reserveId: effectiveReserveId,
    });
  };

  // ── useQuery ──────────────────────────────────────────────────────────────
  // Disabled when mock is present, wallet is disconnected, or address missing.
  const shouldRunQuery = mockPosition === undefined && isConnected && !!address;

  const query = useQuery({
    queryKey: [
      "blendPosition",
      address,
      blendPoolId,
      effectiveReserveId,
      sorobanRpcUrl,
    ],
    queryFn,
    enabled: shouldRunQuery,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: false,
  });

  // ── Mock fast-path ────────────────────────────────────────────────────────
  if (mockPosition !== undefined) {
    return {
      position: mockPosition,
      formattedPosition: formatBlendPosition(mockPosition),
      refetch: () => {},
      isLoading: false,
      error: null,
    };
  }

  // ── Disconnected / no address ─────────────────────────────────────────────
  if (!isConnected || !address) {
    return {
      position: undefined,
      formattedPosition: undefined,
      refetch: query.refetch as () => void,
      isLoading: false,
      error: null,
    };
  }

  // ── Real path ─────────────────────────────────────────────────────────────
  return {
    position: query.data,
    formattedPosition:
      query.data !== undefined ? formatBlendPosition(query.data) : undefined,
    refetch: query.refetch as () => void,
    isLoading: query.isLoading,
    error: (query.error as Error | null) ?? null,
  };
}
