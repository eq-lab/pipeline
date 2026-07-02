/**
 * Stellar/Horizon read hooks for the Balance Sheet panel (Panel A).
 *
 * Both reads use the Horizon REST API, not Soroban simulation:
 *
 * - `useStellarPlusdTotalSupply()` — reads PLUSD supply from Horizon assets endpoint.
 *   The PLUSD SAC (`CBVAYH66…`) does NOT expose `total_supply` via Soroban; instead
 *   `GET /assets?asset_code=PLUSD&asset_issuer={issuer}` returns `balances.authorized`
 *   which is the total PLUSD in circulation as a human-decimal string (e.g. `"10000711.9961018"`).
 *
 * - `useStellarUsdcReserveBalance()` — reads the protocol reserve account's USDC
 *   balance from Horizon: `GET /accounts/{reserveAccountId}`, find the USDC balance entry.
 *   Returns the human-decimal string (e.g. `"1989988801.0000000"`).
 *
 * Both hooks return human-decimal strings that can be formatted directly with
 * `formatCompactUsd(parseFloat(value))` — no SAC 7-decimal scaling needed.
 *
 * Protocol-level reads — NOT gated on a connected wallet.
 *
 * Scale convention
 * ----------------
 * These hooks return Horizon-formatted decimal strings (standard Stellar 7-decimal
 * display format, e.g. "10000711.9961018"). Pass directly to `parseFloat()` then
 * `formatCompactUsd()`. Do NOT apply SAC bigint scaling — that was for Soroban reads.
 */

import { useQuery } from "@tanstack/react-query";
import { plusdIssuerId, reserveAccountId, horizonUrl } from "./chain";

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

// ── useStellarPlusdTotalSupply ────────────────────────────────────────────────

/**
 * Reads the total PLUSD supply in circulation from Horizon.
 *
 * Uses `GET /assets?asset_code=PLUSD&asset_issuer={issuer}` → `balances.authorized`.
 * Returns a human-decimal string (standard Stellar format, e.g. `"10000711.9961018"`).
 * No wallet connection required — this is public protocol state.
 *
 * Returns `undefined` (not an error) when `STELLAR_PLUSD_ISSUER_ID` is not configured.
 */
export function useStellarPlusdTotalSupply(): UseStellarTokenReadResult {
  const isConfigured = !!plusdIssuerId;

  const query = useQuery<string, Error>({
    queryKey: ["stellarPlusdTotalSupply", plusdIssuerId],
    queryFn: async () => {
      const url = `${horizonUrl}/assets?asset_code=PLUSD&asset_issuer=${encodeURIComponent(plusdIssuerId)}`;
      const resp = await fetch(url, {
        headers: { Accept: "application/json" },
      });
      if (!resp.ok) {
        throw new Error(
          `Horizon /assets fetch failed: ${resp.status} ${resp.statusText}`,
        );
      }
      const data = (await resp.json()) as {
        _embedded?: { records?: { balances?: { authorized?: string } }[] };
      };
      const record = data._embedded?.records?.[0];
      const authorized = record?.balances?.authorized;
      if (!authorized) {
        throw new Error("PLUSD asset not found or balances.authorized missing");
      }
      return authorized;
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

// ── useStellarUsdcReserveBalance ──────────────────────────────────────────────

interface HorizonBalance {
  balance: string;
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
}

/**
 * Reads the protocol reserve account's USDC balance from Horizon.
 *
 * Uses `GET /accounts/{reserveAccountId}` and finds the balance entry where
 * `asset_code === "USDC"` and `asset_type !== "native"`.
 * Returns a human-decimal string (e.g. `"1989988801.0000000"`).
 * No wallet connection required.
 *
 * Returns `undefined` (not an error) when `STELLAR_RESERVE_ACCOUNT_ID` is not
 * configured (row renders `—`).
 */
export function useStellarUsdcReserveBalance(): UseStellarTokenReadResult {
  const isConfigured = !!reserveAccountId;

  const query = useQuery<string, Error>({
    queryKey: ["stellarUsdcReserveBalance", reserveAccountId],
    queryFn: async () => {
      const url = `${horizonUrl}/accounts/${encodeURIComponent(reserveAccountId)}`;
      const resp = await fetch(url, {
        headers: { Accept: "application/json" },
      });
      if (!resp.ok) {
        throw new Error(
          `Horizon /accounts fetch failed: ${resp.status} ${resp.statusText}`,
        );
      }
      const data = (await resp.json()) as { balances?: HorizonBalance[] };
      const usdcEntry = data.balances?.find(
        (b) => b.asset_type !== "native" && b.asset_code === "USDC",
      );
      if (!usdcEntry) {
        // Account exists but holds no USDC — return "0.0000000"
        return "0.0000000";
      }
      return usdcEntry.balance;
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
