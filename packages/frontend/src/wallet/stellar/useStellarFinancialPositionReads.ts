/**
 * Stellar on-chain read hooks for the Balance Sheet panel (Panel A).
 *
 * - `useStellarPlusdTotalSupply()` — total PLUSD in circulation (LIABILITY).
 *   Source: Horizon REST `GET /assets?asset_code=PLUSD&asset_issuer={plusdIssuerId}`
 *   → `_embedded.records[0].balances.authorized` (human-decimal string).
 *   Rationale: a SAC exposes no Soroban `total_supply` view for a classic asset;
 *   Horizon `/assets` is the only reliable source for issued supply.
 *
 * - `useStellarUsdcCustodyBalance()` — USDC held in Pipeline's custody (ASSET).
 *   Source: direct Soroban contract call `usdc_SAC.balance(usdcCustodyId)`.
 *   Returns a raw i128 bigint at 7-decimal SAC scale.
 *   Defensive guard: if the returned bigint equals the i64/i128 max sentinel
 *   (~9223372036854775807) the hook returns `undefined` so the row renders `—`
 *   rather than a garbage ~$922B figure (an issuer account returns that sentinel).
 *
 * Protocol-level reads — NOT gated on a connected wallet.
 *
 * Scale convention
 * ----------------
 * `useStellarPlusdTotalSupply` returns a Horizon-formatted decimal string
 * (e.g. "10000711.9961018"). Pass directly to `parseFloat()` then
 * `formatCompactUsd()`. Do NOT apply SAC bigint scaling.
 *
 * `useStellarUsdcCustodyBalance` returns a raw i128 bigint at 7-decimal scale.
 * Divide by 10^7 (or use `sacRawToDisplay`) before formatting.
 */

import { useQuery } from "@tanstack/react-query";
import { plusdIssuerId, horizonUrl, usdcId, usdcCustodyId } from "./chain";
import { createTokenClient } from "./contracts/token";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UseStellarTokenReadResult {
  /**
   * Human-decimal string (Horizon format, e.g. `"10000711.9961018"`), or
   * `undefined` while loading / unconfigured.
   */
  data: string | undefined;
  isLoading: boolean;
  error: Error | null;
}

export interface UseStellarUsdcCustodyBalanceResult {
  /**
   * Raw i128 bigint at 7-decimal SAC scale (e.g. `100000000n` = 10 USDC), or
   * `undefined` while loading / unconfigured / sentinel detected.
   */
  data: bigint | undefined;
  isLoading: boolean;
  error: Error | null;
}

// ── Sentinel guard ────────────────────────────────────────────────────────────

/**
 * i64 max value — a SAC `balance()` call on an issuer account returns this
 * sentinel instead of a real balance. If we see it, treat as unconfigured (→ `—`).
 */
const I64_MAX = 9223372036854775807n;

function isSentinel(raw: bigint): boolean {
  return raw >= I64_MAX;
}

// ── Shared helper ─────────────────────────────────────────────────────────────

/**
 * Fetches `GET {url}` (a Horizon /assets URL) and returns
 * `_embedded.records[0].balances.authorized` as a human-decimal string.
 */
async function fetchHorizonAssetSupply(
  url: string,
  label: string,
): Promise<string> {
  const resp = await fetch(url, { headers: { Accept: "application/json" } });
  if (!resp.ok) {
    throw new Error(
      `Horizon /assets fetch failed for ${label}: ${resp.status} ${resp.statusText}`,
    );
  }
  const data = (await resp.json()) as {
    _embedded?: { records?: { balances?: { authorized?: string } }[] };
  };
  const authorized = data._embedded?.records?.[0]?.balances?.authorized;
  if (!authorized) {
    throw new Error(
      `${label} asset not found or balances.authorized missing in Horizon response`,
    );
  }
  return authorized;
}

// ── useStellarPlusdTotalSupply ────────────────────────────────────────────────

/**
 * Reads the total PLUSD supply in circulation from Horizon.
 *
 * `GET /assets?asset_code=PLUSD&asset_issuer={plusdIssuerId}` → `balances.authorized`.
 * Returns a human-decimal string (e.g. `"10000711.9961018"`).
 * No wallet connection required.
 *
 * Returns `undefined` when `VITE_STELLAR_PLUSD_ISSUER_ID` is not configured.
 */
export function useStellarPlusdTotalSupply(): UseStellarTokenReadResult {
  const isConfigured = !!plusdIssuerId;

  const query = useQuery<string, Error>({
    queryKey: ["stellarPlusdTotalSupply", plusdIssuerId],
    queryFn: () => {
      const url = `${horizonUrl}/assets?asset_code=PLUSD&asset_issuer=${encodeURIComponent(plusdIssuerId)}`;
      return fetchHorizonAssetSupply(url, "PLUSD");
    },
    enabled: isConfigured,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: false,
  });

  if (!isConfigured) {
    return { data: undefined, isLoading: false, error: null };
  }

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error ?? null,
  };
}

// ── useStellarUsdcCustodyBalance ──────────────────────────────────────────────

/**
 * Reads Pipeline's USDC custody balance via a direct Soroban contract call.
 *
 * Calls `usdc_SAC.balance(usdcCustodyId)` — NOT the total USDC supply.
 * Returns a raw i128 bigint at 7-decimal SAC scale (e.g. `10_000_000n` = 1 USDC).
 * No wallet connection required.
 *
 * Sentinel guard: if the returned balance equals the i64 max value
 * (~9223372036854775807), the hook returns `undefined` — an issuer account
 * returns that sentinel and would render as a garbage ~$922B figure.
 *
 * Returns `undefined` when `VITE_STELLAR_USDC_ID` or `VITE_STELLAR_USDC_CUSTODY_ID`
 * is not configured.
 */
export function useStellarUsdcCustodyBalance(): UseStellarUsdcCustodyBalanceResult {
  const isConfigured = !!usdcId && !!usdcCustodyId;

  const query = useQuery<bigint, Error>({
    queryKey: ["stellarUsdcCustodyBalance", usdcId, usdcCustodyId],
    queryFn: async () => {
      const client = createTokenClient(usdcId);
      if (!client) {
        throw new Error(
          "useStellarUsdcCustodyBalance: USDC SAC contract not configured",
        );
      }
      const raw = await client.balance(usdcCustodyId);
      if (isSentinel(raw)) {
        // The custody account is an issuer — return a value that signals "unconfigured"
        // so callers render `—` rather than a garbage ~$922B figure.
        throw new Error(
          "useStellarUsdcCustodyBalance: balance returned i64 max sentinel — " +
            "the configured custody account may be an issuer account",
        );
      }
      return raw;
    },
    enabled: isConfigured,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: false,
  });

  if (!isConfigured) {
    return { data: undefined, isLoading: false, error: null };
  }

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error ?? null,
  };
}
