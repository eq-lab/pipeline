/**
 * Stellar USDC balance read hook.
 *
 * Reads the connected Stellar account's USDC balance from the Horizon server
 * and returns it in a shape consistent with EVM `useEvmToken` consumers.
 *
 * Mock layer:
 *   `pipeline.mock.wallet.stellar.balance.usdc` — human-scaled decimal string
 *   (e.g. `"1.5"` = 1.5 USDC, matching what Horizon returns). When set, the
 *   hook returns the mock value without constructing a `Horizon.Server` or
 *   calling `loadAccount`.
 *
 * Return shape:
 *   - `balance`          — raw Horizon decimal string (e.g. `"1234.5678900"`),
 *                          or `undefined` when disconnected / loading.
 *   - `formattedBalance` — USD currency string (e.g. `"$1,234.57"`), or
 *                          `undefined` when disconnected / loading.
 *   - `refetchBalance`   — re-triggers the Horizon query (mirrors `useEvmToken`).
 *   - `isLoading`        — `true` while the first query is in-flight.
 *   - `error`            — `Error | null` from the underlying query.
 *
 * No-trustline: if the account has no USDC trustline, `balance` is `"0"` and
 * `formattedBalance` is `"$0.00"` — NOT an error.
 *
 * Unfunded account (404 from Horizon): treated the same as no-trustline →
 * `balance === "0"`, `error === null`. The account simply holds nothing yet.
 *
 * USDC is matched by BOTH `asset_code === "USDC"` AND
 * `asset_issuer === usdcIssuer` to avoid picking up a same-code asset from a
 * different (fake) issuer.
 */
import { useQuery } from "@tanstack/react-query";
import { Horizon } from "@stellar/stellar-sdk";
import { horizonUrl, usdcIssuer } from "./chain";
import { useMock, readMock } from "../evm/mock";
import { useStellarWallet } from "./useStellarWallet";
import { STELLAR_MOCK_KEYS } from "./mock";

// ── Parse helpers ──────────────────────────────────────────────────────────────

/** Identity parser — passes the raw string through as-is. */
function parseString(raw: string): string {
  return raw;
}

// ── Format helper ─────────────────────────────────────────────────────────────

/**
 * Formats a human-scaled USDC decimal string (e.g. `"1234.5678900"`) as a
 * USD currency string (e.g. `"$1,234.57"`).
 *
 * Mirrors the `formattedBalance` formatter in `useEvmToken.ts` so the TopBar
 * pill is consistent between EVM and Stellar.
 */
export function formatUsdcDisplay(decimalStr: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(decimalStr));
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UseStellarTokenResult {
  /**
   * Raw Horizon decimal string (e.g. `"1234.5678900"`), or `undefined` when
   * disconnected or loading.
   */
  balance: string | undefined;
  /**
   * USD currency string (e.g. `"$1,234.57"`). `undefined` when disconnected
   * or loading.
   */
  formattedBalance: string | undefined;
  /** Re-triggers the Horizon query. Mirrors `useEvmToken.refetchBalance`. */
  refetchBalance: () => void;
  /** `true` while the first query is in-flight. */
  isLoading: boolean;
  /** Error from the Horizon query, or `null`. */
  error: Error | null;
}

// ── useStellarToken ───────────────────────────────────────────────────────────

/**
 * Returns the connected Stellar account's USDC balance from the Horizon server.
 *
 * Sits within the shared `QueryClientProvider` mounted by `EvmWalletProvider`
 * (the same client used by `useNetworkFeeEstimate`) — no second provider needed.
 * Uses `@tanstack/react-query` directly (allowed in `src/wallet/**`).
 */
export function useStellarToken(): UseStellarTokenResult {
  const { address, isConnected } = useStellarWallet();

  // ── Mock read (reactive) ──────────────────────────────────────────────────
  const mockBalance = useMock(STELLAR_MOCK_KEYS.balanceUsdc, parseString);

  // ── Query function ────────────────────────────────────────────────────────

  const queryFn = async (): Promise<string> => {
    // Re-read mock at query time (covers non-reactive query re-runs).
    const mockVal = readMock(STELLAR_MOCK_KEYS.balanceUsdc, parseString);
    if (mockVal !== undefined) {
      return mockVal;
    }

    if (!address) return "0";

    let balances: Horizon.HorizonApi.BalanceLine[];
    try {
      const server = new Horizon.Server(horizonUrl);
      const account = await server.loadAccount(address);
      balances = account.balances;
    } catch (err) {
      // 404 / NotFoundError → unfunded account, treat as zero balance.
      if (isNotFoundError(err)) {
        return "0";
      }
      throw err;
    }

    // Scan balances for the USDC entry matching BOTH code AND issuer.
    for (const b of balances) {
      if (
        b.asset_type !== "native" &&
        b.asset_type !== "liquidity_pool_shares" &&
        (b as Horizon.HorizonApi.BalanceLineAsset).asset_code === "USDC" &&
        (b as Horizon.HorizonApi.BalanceLineAsset).asset_issuer === usdcIssuer
      ) {
        return (b as Horizon.HorizonApi.BalanceLineAsset).balance;
      }
    }

    // No USDC trustline → zero balance.
    return "0";
  };

  // ── useQuery ──────────────────────────────────────────────────────────────
  // Disabled when mock is present, wallet is disconnected, or address missing.
  const shouldRunQuery = mockBalance === undefined && isConnected && !!address;

  const query = useQuery({
    queryKey: ["stellarUsdcBalance", address, usdcIssuer, horizonUrl],
    queryFn,
    enabled: shouldRunQuery,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: false,
  });

  // ── Mock fast-path ────────────────────────────────────────────────────────
  if (mockBalance !== undefined) {
    return {
      balance: mockBalance,
      formattedBalance: formatUsdcDisplay(mockBalance),
      refetchBalance: () => {},
      isLoading: false,
      error: null,
    };
  }

  // ── Disconnected / no address ─────────────────────────────────────────────
  if (!isConnected || !address) {
    return {
      balance: undefined,
      formattedBalance: undefined,
      refetchBalance: query.refetch as () => void,
      isLoading: false,
      error: null,
    };
  }

  // ── Real path ─────────────────────────────────────────────────────────────
  return {
    balance: query.data,
    formattedBalance:
      query.data !== undefined ? formatUsdcDisplay(query.data) : undefined,
    refetchBalance: query.refetch as () => void,
    isLoading: query.isLoading,
    error: (query.error as Error | null) ?? null,
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Returns `true` when `err` looks like a Horizon 404 / NotFoundError.
 * The stellar-sdk throws a `NetworkError` (or `BadResponseError`) whose
 * `response.status` is 404. Accept both the `.response.status` path
 * (stellar-sdk v9+) and a plain `.status` property on the error object.
 */
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
