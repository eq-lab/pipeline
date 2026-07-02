/**
 * Stellar/Soroban read hooks for the Balance Sheet panel (Panel A).
 *
 * Protocol-level reads — NOT gated on a connected wallet. These read contract
 * state that is public (`total_supply`, `balance(account)`), so the panel
 * renders with no wallet connected.
 *
 * Hooks:
 *   - `useStellarPlusdTotalSupply()`    — PLUSD outstanding (senior claims).
 *   - `useStellarUsdcReserveBalance()` — protocol USDC reserve (liquid assets).
 *
 * Mock layer (localStorage — dev only)
 * --------------------------------------
 *   `pipeline.mock.wallet.stellar.plusd.totalSupply`
 *     → Raw bigint string at 7-decimal SAC scale (e.g. `"431400000000000"` ≈ $43.14M)
 *   `pipeline.mock.wallet.stellar.usdc.reserveBalance`
 *     → Raw bigint string at 7-decimal SAC scale (e.g. `"100000000000"` ≈ $10K)
 *
 * Scale convention
 * ----------------
 * Stellar SAC tokens use 7 decimals (SAC_DECIMALS = 7).
 * 1 PLUSD = 1 USDC = 10_000_000n (raw bigint).
 * Use `sacRawToDisplay(raw, 7)` to convert to a human-readable decimal string.
 * Do NOT mix with REST base-6 decimal strings — those use `formatCompactUsd`.
 */

import { useQuery } from "@tanstack/react-query";
import { createTokenClient } from "./contracts/token";
import { plusdId, usdcId, reserveAccountId } from "./chain";
import {
  STELLAR_MOCK_KEYS,
  readMockStellarPlusdTotalSupply,
  readMockStellarUsdcReserveBalance,
} from "./mock";
import { useMock, parseBigInt } from "../evm/mock";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UseStellarTokenReadResult {
  /** Raw i128 bigint at 7-decimal SAC scale, or `undefined` while loading / unconfigured. */
  data: bigint | undefined;
  isLoading: boolean;
  error: Error | null;
}

// ── useStellarPlusdTotalSupply ────────────────────────────────────────────────

/**
 * Reads `total_supply()` from the PLUSD SAC contract.
 *
 * Returns the total PLUSD outstanding as a raw i128 bigint at 7-decimal scale.
 * No wallet connection required — this is protocol-level public state.
 *
 * Returns `undefined` (not an error) when `STELLAR_PLUSD_ID` is not configured.
 */
export function useStellarPlusdTotalSupply(): UseStellarTokenReadResult {
  // ── Mock fast-path (reactive) ─────────────────────────────────────────────
  const mockValue = useMock(STELLAR_MOCK_KEYS.plusdTotalSupply, parseBigInt);

  const isConfigured = !!plusdId;

  const query = useQuery<bigint, Error>({
    queryKey: ["stellarPlusdTotalSupply", plusdId],
    queryFn: async () => {
      // Re-read mock at query time (non-reactive path).
      const mock = readMockStellarPlusdTotalSupply();
      if (mock !== undefined) return mock;

      const client = createTokenClient(plusdId);
      if (!client) throw new Error("PLUSD contract not configured");
      return client.totalSupply();
    },
    enabled: isConfigured && mockValue === undefined,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: false,
  });

  // ── Mock path ─────────────────────────────────────────────────────────────
  if (mockValue !== undefined) {
    return { data: mockValue, isLoading: false, error: null };
  }

  // ── Unconfigured short-circuit ────────────────────────────────────────────
  if (!isConfigured) {
    return { data: undefined, isLoading: false, error: null };
  }

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error ?? null,
  };
}

// ── useStellarUsdcReserveBalance ──────────────────────────────────────────────

/**
 * Reads `balance(reserveAccount)` from the USDC SAC contract.
 *
 * Returns the protocol's USDC reserve as a raw i128 bigint at 7-decimal scale.
 * No wallet connection required — this is protocol-level public state.
 *
 * Returns `undefined` (not an error) when either `STELLAR_USDC_ID` or
 * `STELLAR_RESERVE_ACCOUNT_ID` is not configured (row renders `—`). The reserve
 * holder is a confirmed G-account (see `chain.ts` / `.env`).
 */
export function useStellarUsdcReserveBalance(): UseStellarTokenReadResult {
  // ── Mock fast-path (reactive) ─────────────────────────────────────────────
  const mockValue = useMock(STELLAR_MOCK_KEYS.usdcReserveBalance, parseBigInt);

  const isConfigured = !!usdcId && !!reserveAccountId;

  const query = useQuery<bigint, Error>({
    queryKey: ["stellarUsdcReserveBalance", usdcId, reserveAccountId],
    queryFn: async () => {
      // Re-read mock at query time (non-reactive path).
      const mock = readMockStellarUsdcReserveBalance();
      if (mock !== undefined) return mock;

      const client = createTokenClient(usdcId);
      if (!client) throw new Error("USDC contract not configured");
      return client.balance(reserveAccountId);
    },
    enabled: isConfigured && mockValue === undefined,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: false,
  });

  // ── Mock path ─────────────────────────────────────────────────────────────
  if (mockValue !== undefined) {
    return { data: mockValue, isLoading: false, error: null };
  }

  // ── Unconfigured short-circuit ────────────────────────────────────────────
  if (!isConfigured) {
    return { data: undefined, isLoading: false, error: null };
  }

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error ?? null,
  };
}
