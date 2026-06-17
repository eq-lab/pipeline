/**
 * Parameterized SAC (Stellar Asset Contract) token hook for the protocol's
 * own USDC and PLUSD assets.
 *
 * This hook is DISTINCT from `useStellarToken` (which reads Circle USDC via
 * the Blend lending pool). It is designed for the protocol's SAC tokens:
 *   - USDC:  `CCWX3TKH3K5SQDPOBGQTGOGE6Q5VEZWCOYJ2HDVV5U6GNN5U4WOEB3C7`
 *   - PLUSD: `CAC7JMGRFZBL4IS4WBO5R3AMTK3C53FEOQZSU2WL5C4TWCRFAYWFSIBN`
 * Both are issued by `GC5SUAXMROK67LIE3DDMJG3AHHEVSFDAZ55A4WS655XYSKIN46RG7ACM`
 * and use **7 decimals** (Stellar SAC standard — NOT EVM's 6).
 *
 * ## Key differences from `useStellarToken`
 *   - Parameterized: accepts `{ assetCode, assetIssuer, contractId }`.
 *   - Decimals: **7** (read from the SAC `decimals()` view or well-known constant).
 *   - Exposes `hasTrustline: boolean` alongside balance.
 *   - Exposes `decimals: number` so callers can scale correctly.
 *
 * ## Amount convention
 *   SAC balances from Horizon are human-decimal strings (e.g. `"1.2345678"`).
 *   The raw i128 fixed-point representation (for Soroban write calls) is
 *   `bigint` with 7 decimal places: `1 USDC = 10_000_000n`.
 *   Use `sacDisplayToRaw` / `sacRawToDisplay` for conversion.
 *
 * ## Balance and trustline reads
 *   Horizon `loadAccount().balances` is used for balance + trustline detection
 *   (consistent with `useStellarToken`). A missing trustline returns `"0"` and
 *   `hasTrustline: false`. A 404 (unfunded account) is also treated as `"0"`.
 *
 * ## Issuer mismatch guard
 *   Only balances matching BOTH `asset_code === assetCode` AND
 *   `asset_issuer === assetIssuer` are counted — prevents accidentally picking
 *   up a same-code asset from a different issuer.
 *
 * ## Mock layer (localStorage — dev only)
 *   Keys: `pipeline.mock.wallet.stellar.balance.sac.usdc`  (for USDC)
 *         `pipeline.mock.wallet.stellar.balance.sac.plusd` (for PLUSD)
 *   Both accept a raw bigint string (7-decimal fixed-point, e.g. `"10000000"` = 1).
 *   When set, the hook returns the mock value without constructing a Horizon server.
 *
 * ## Scaling helpers (exported)
 *   `SAC_DECIMALS` — well-known constant `7`.
 *   `sacRawToDisplay(raw, decimals?)` — converts raw i128 bigint to human string.
 *   `sacDisplayToRaw(display, decimals?)` — converts human string to i128 bigint.
 */

import { useQuery } from "@tanstack/react-query";
import { Horizon } from "@stellar/stellar-sdk";
import { horizonUrl } from "./chain";
import { useMock, readMock, parseBigInt } from "../evm/mock";
import { useStellarWallet } from "./useStellarWallet";
import { STELLAR_MOCK_KEYS } from "./mock";

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Stellar SAC standard decimal count.
 * Protocol USDC and PLUSD both use 7 decimals — do NOT assume 6 (EVM USDC).
 */
export const SAC_DECIMALS = 7;

// ── Scaling helpers ───────────────────────────────────────────────────────────

/**
 * Converts a raw i128 bigint (7-decimal fixed-point) to a human-readable
 * decimal string.
 * Example: `sacRawToDisplay(10_000_000n)` → `"1.0000000"`
 */
export function sacRawToDisplay(
  raw: bigint,
  decimals: number = SAC_DECIMALS,
): string {
  const factor = BigInt(10 ** decimals);
  const whole = raw / factor;
  const frac = raw % factor;
  const fracStr = frac.toString().padStart(decimals, "0");
  return `${whole}.${fracStr}`;
}

/**
 * Converts a human-readable decimal string to a raw i128 bigint (7-decimal
 * fixed-point). Truncates (rounds toward zero) — no rounding up.
 * Example: `sacDisplayToRaw("1.5")` → `15_000_000n`
 */
export function sacDisplayToRaw(
  display: string,
  decimals: number = SAC_DECIMALS,
): bigint {
  const parts = display.split(".");
  const wholePart = parts[0] ?? "0";
  const fracPart = parts[1] ?? "";
  const fracTrimmed = fracPart.slice(0, decimals).padEnd(decimals, "0");
  return BigInt(wholePart) * BigInt(10 ** decimals) + BigInt(fracTrimmed);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UseStellarSacTokenParams {
  /**
   * Classic asset code, e.g. `"USDC"` or `"PLUSD"`.
   * Used to match the Horizon balance entry.
   */
  assetCode: string;
  /**
   * Classic issuer public key (`G…`).
   * IMPORTANT: for the protocol assets this is `GC5SUAXMROK67LIE3DDMJG3AHHEVSFDAZ55A4WS655XYSKIN46RG7ACM`,
   * NOT the Circle issuer from `chain.ts`.
   */
  assetIssuer: string;
  /**
   * Soroban contract ID for this SAC (used as query-key disambiguator and for
   * future on-chain balance reads if Horizon is insufficient).
   */
  contractId: string;
  /**
   * Optional mock key override.  When provided, the hook reads from this
   * localStorage key instead of the default per-asset keys.
   * Defaults to the `STELLAR_MOCK_KEYS.balanceSacUsdc` or
   * `STELLAR_MOCK_KEYS.balanceSacPlusd` key based on `assetCode`.
   */
  mockKey?: string;
}

export interface UseStellarSacTokenResult {
  /**
   * Raw Horizon decimal string (e.g. `"1.2345678"`), or `undefined` when
   * disconnected / loading.
   */
  balance: string | undefined;
  /**
   * Whether the connected account has a trustline for this asset.
   * `false` when disconnected, loading, or when no trustline exists.
   */
  hasTrustline: boolean;
  /**
   * Decimal count for this SAC (always 7 for protocol USDC/PLUSD).
   */
  decimals: number;
  /** Re-triggers the Horizon query. */
  refetchBalance: () => void;
  /** `true` while the first query is in-flight. */
  isLoading: boolean;
  /** Error from the Horizon query, or `null`. */
  error: Error | null;
}

// ── useStellarSacToken ────────────────────────────────────────────────────────

/**
 * Returns the connected Stellar account's balance and trustline status for a
 * protocol SAC (USDC or PLUSD) from the Horizon server.
 *
 * Sit inside the shared `QueryClientProvider` — no additional provider needed.
 */
export function useStellarSacToken({
  assetCode,
  assetIssuer,
  contractId,
  mockKey,
}: UseStellarSacTokenParams): UseStellarSacTokenResult {
  const { address, isConnected } = useStellarWallet();

  // Resolve which mock key to use for this asset.
  const resolvedMockKey =
    mockKey ??
    (assetCode === "USDC"
      ? STELLAR_MOCK_KEYS.balanceSacUsdc
      : assetCode === "PLUSD"
        ? STELLAR_MOCK_KEYS.balanceSacPlusd
        : `pipeline.mock.wallet.stellar.balance.sac.${assetCode.toLowerCase()}`);

  // ── Mock read (reactive) ──────────────────────────────────────────────────
  const mockRaw = useMock(resolvedMockKey, parseBigInt);

  // ── Query function ────────────────────────────────────────────────────────

  const queryFn = async (): Promise<{
    balance: string;
    hasTrustline: boolean;
  }> => {
    // Re-read mock at query time.
    const mockVal = readMock(resolvedMockKey, parseBigInt);
    if (mockVal !== undefined) {
      return {
        balance: sacRawToDisplay(mockVal),
        hasTrustline: mockVal > 0n,
      };
    }

    if (!address) return { balance: "0", hasTrustline: false };

    let balances: Horizon.HorizonApi.BalanceLine[];
    try {
      const server = new Horizon.Server(horizonUrl);
      const account = await server.loadAccount(address);
      balances = account.balances;
    } catch (err) {
      if (isNotFoundError(err)) {
        return { balance: "0", hasTrustline: false };
      }
      throw err;
    }

    // Scan for this asset — match BOTH code AND issuer.
    for (const b of balances) {
      if (
        b.asset_type !== "native" &&
        b.asset_type !== "liquidity_pool_shares" &&
        (b as Horizon.HorizonApi.BalanceLineAsset).asset_code === assetCode &&
        (b as Horizon.HorizonApi.BalanceLineAsset).asset_issuer === assetIssuer
      ) {
        return {
          balance: (b as Horizon.HorizonApi.BalanceLineAsset).balance,
          hasTrustline: true,
        };
      }
    }

    // No trustline → zero, not an error.
    return { balance: "0", hasTrustline: false };
  };

  // ── useQuery ──────────────────────────────────────────────────────────────
  const shouldRunQuery = mockRaw === undefined && isConnected && !!address;

  const query = useQuery({
    queryKey: [
      "stellarSacToken",
      contractId,
      assetCode,
      assetIssuer,
      address,
      horizonUrl,
    ],
    queryFn,
    enabled: shouldRunQuery,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: false,
  });

  // ── Mock fast-path ────────────────────────────────────────────────────────
  if (mockRaw !== undefined) {
    return {
      balance: sacRawToDisplay(mockRaw),
      hasTrustline: mockRaw > 0n,
      decimals: SAC_DECIMALS,
      refetchBalance: () => {},
      isLoading: false,
      error: null,
    };
  }

  // ── Disconnected / no address ─────────────────────────────────────────────
  if (!isConnected || !address) {
    return {
      balance: undefined,
      hasTrustline: false,
      decimals: SAC_DECIMALS,
      refetchBalance: query.refetch as () => void,
      isLoading: false,
      error: null,
    };
  }

  // ── Real path ─────────────────────────────────────────────────────────────
  return {
    balance: query.data?.balance,
    hasTrustline: query.data?.hasTrustline ?? false,
    decimals: SAC_DECIMALS,
    refetchBalance: query.refetch as () => void,
    isLoading: query.isLoading,
    error: (query.error as Error | null) ?? null,
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Returns `true` when `err` looks like a Horizon 404 / NotFoundError. */
function isNotFoundError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const anyErr = err as Record<string, unknown>;
  if (typeof anyErr.status === "number" && anyErr.status === 404) return true;
  const response = anyErr.response as Record<string, unknown> | undefined;
  if (
    response &&
    typeof response.status === "number" &&
    response.status === 404
  )
    return true;
  return false;
}
