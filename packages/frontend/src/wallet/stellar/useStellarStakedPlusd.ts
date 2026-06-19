/**
 * Stellar/Soroban StakedPLUSD (sPLUSD) FungibleVault hooks.
 *
 * Provides hooks for interacting with the Pipeline StakedPLUSD vault contract
 * on Stellar — the Soroban counterpart of the EVM `useStakedPlusd.ts` hooks.
 *
 * Write hooks:
 *   - `useStellarStake(amountRaw)`   — `deposit(assets, receiver, from, operator) → shares`
 *   - `useStellarUnstake(sharesRaw)` — `redeem(shares, receiver, owner, operator) → assets`
 *
 * Read hooks (via React Query):
 *   - `useStellarStakedPlusdAsset()`          — underlying PLUSD SAC contract ID
 *   - `useStellarStakeConvertToShares(assets)` — PLUSD → sPLUSD preview
 *   - `useStellarUnstakeConvertToAssets(shares)` — sPLUSD → PLUSD preview
 *   - `useStellarStakedPlusdBalance()`         — LP's sPLUSD share balance
 *
 * Trustline hook:
 *   - `useStellarChangeTrustStakedPlusd()` — builds + submits a classic `changeTrust`
 *     op for the sPLUSD share asset; exposes `needsTrustline` + `submit()`.
 *
 * All write hooks expose the same state shape:
 *   `{ write, data, isPending, isSuccess, error, reset }`
 *
 * Interface notes
 * ---------------
 * The vault contract IS the sPLUSD share token (no separate share contract).
 * `balance(account)` reads LP's sPLUSD shares directly off the vault.
 * `deposit` and `redeem` each take four on-chain args; `sender == from == operator`
 * for user-initiated calls — a single Soroban auth entry is sufficient.
 *
 * Mock layer (localStorage — dev only)
 * -------------------------------------
 *   `pipeline.mock.wallet.stellar.stakedPlusd.stake`
 *     → JSON `{ hash: "...", shares?: "9600000" }`
 *   `pipeline.mock.wallet.stellar.stakedPlusd.unstake`
 *     → JSON `{ hash: "...", assets?: "10400000" }`
 *   `pipeline.mock.wallet.stellar.stakedPlusd.changeTrust`
 *     → JSON `{ hash: "..." }` (falls back to shared `changeTrust` key)
 *   `pipeline.mock.wallet.stellar.stakedPlusd.convertToShares`
 *     → Raw bigint rate at SAC 1e7 scale: output = (input * rate) / 1e7
 *   `pipeline.mock.wallet.stellar.stakedPlusd.convertToAssets`
 *     → Raw bigint rate at SAC 1e7 scale: output = (input * rate) / 1e7
 *   `pipeline.mock.wallet.stellar.stakedPlusd.shareBalance`
 *     → Raw bigint string (7-decimal fixed-point, e.g. `"10000000"` = 1 sPLUSD)
 *
 * Conversion-scale convention
 * ---------------------------
 * The convert mock keys hold a rate at **SAC 1e7 scale** (NOT 1e18 EVM scale).
 * Given rate `r` and input `n`, the output is `(n * r) / 1e7`.
 * Example: rate `"9600000"` (= 0.96 at 1e7) →
 *   `convertToShares(10_000_000n)` → `9_600_000n`
 * This avoids the #541 off-by-powers-of-ten class of bug.
 */

import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  rpc,
  TransactionBuilder,
  Transaction,
  Horizon,
  Asset,
  Operation,
  scValToNative,
} from "@stellar/stellar-sdk";
import {
  StakedPlusdClient,
  createStakedPlusdClient,
} from "./contracts/stakedPlusd";
import { useStellarWallet } from "./useStellarWallet";
import {
  stakedPlusdId,
  sorobanRpcUrl,
  networkPassphrase,
  horizonUrl,
} from "./chain";
import { useStellarSacToken, SAC_DECIMALS } from "./useStellarSacToken";
import {
  readMockStellarStake,
  readMockStellarUnstake,
  readMockStellarChangeTrustStakedPlusd,
  readMockStellarStakedPlusdConvertToShares,
  readMockStellarStakedPlusdConvertToAssets,
  readMockStellarStakedPlusdShareBalance,
  STELLAR_MOCK_KEYS,
} from "./mock";
import { useMock, parseBigInt } from "../evm/mock";

// ── Scale factor for rate-based convert mock arithmetic (SAC 1e7, NOT EVM 1e18) ──

const SAC_RATE_SCALE = BigInt(10 ** SAC_DECIMALS);

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StellarStakeResult {
  write: (assetsRaw: bigint) => void;
  /** `{ hash, shares? }` on success; `undefined` while pending or before first call. */
  data: { hash: string; shares?: string } | undefined;
  isPending: boolean;
  isSuccess: boolean;
  error: Error | null;
  reset: () => void;
}

export interface StellarUnstakeResult {
  write: (sharesRaw: bigint) => void;
  /** `{ hash, assets? }` on success; `undefined` while pending or before first call. */
  data: { hash: string; assets?: string } | undefined;
  isPending: boolean;
  isSuccess: boolean;
  error: Error | null;
  reset: () => void;
}

export interface UseStellarStakedPlusdAssetResult {
  /** PLUSD SAC Soroban contract ID, or `undefined` when unconfigured or loading. */
  plusdContractId: string | undefined;
  isLoading: boolean;
  error: Error | null;
}

export interface UseStellarConvertResult {
  /** Converted amount in raw i128 at 7-decimal scale, or `undefined` when loading. */
  data: bigint | undefined;
  isLoading: boolean;
  error: Error | null;
}

export interface UseStellarStakedPlusdBalanceResult {
  /** Raw sPLUSD share balance at 7-decimal scale, or `undefined` when disconnected. */
  balance: bigint | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Fail-safe trustline status for the sPLUSD share asset.
 *
 * - `"loading"`   — share asset or trustline check is still in flight.
 * - `"error"`     — `name()` call failed or returned an unexpected format.
 * - `"needed"`    — share asset resolved, trustline is missing.
 * - `"satisfied"` — share asset resolved AND trustline exists.
 *
 * The step must be marked "success" and staking may proceed ONLY when
 * `trustlineStatus === "satisfied"`.
 */
export type StellarSplusdTrustlineStatus =
  | "loading"
  | "error"
  | "needed"
  | "satisfied";

export interface UseStellarChangeTrustStakedPlusdResult {
  submit: () => void;
  /**
   * Fail-safe discriminated status for the sPLUSD trustline step.
   * The step shows "success" and staking is allowed ONLY when this is
   * `"satisfied"`. While `"loading"` or `"error"` the step remains actionable
   * (never silently OK) and staking is blocked.
   */
  trustlineStatus: StellarSplusdTrustlineStatus;
  /**
   * `true` only when the trustline is confirmed missing (`trustlineStatus ===
   * "needed"`). Used to enable the "Enable" submit button. Kept for
   * backward-compat; prefer `trustlineStatus` for gate decisions.
   */
  needsTrustline: boolean;
  data: { hash: string } | undefined;
  isPending: boolean;
  isSuccess: boolean;
  error: Error | null;
  reset: () => void;
}

// ── useStellarStake ───────────────────────────────────────────────────────────

/**
 * Write hook for `deposit(assets, receiver, from, operator) → shares`.
 *
 * Stakes PLUSD into the FungibleVault, receiving sPLUSD shares.
 * The sender acts as `from` and `operator` — a single Soroban auth entry is
 * sufficient (no separate approve() needed).
 *
 * @example
 * ```tsx
 * const { write, data, isPending, isSuccess, error, reset } = useStellarStake();
 * // Stake 1 PLUSD (7 decimals: 10_000_000n)
 * write(10_000_000n);
 * ```
 */
export function useStellarStake(): StellarStakeResult {
  const [data, setData] = useState<
    { hash: string; shares?: string } | undefined
  >(undefined);
  const [isPending, setIsPending] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isInFlight, setIsInFlight] = useState(false);

  const { address, isConnected, signTransaction } = useStellarWallet();

  const reset = useCallback(() => {
    setData(undefined);
    setIsPending(false);
    setIsSuccess(false);
    setError(null);
  }, []);

  const write = useCallback(
    (assetsRaw: bigint) => {
      // ── Mock fast-path ────────────────────────────────────────────────────
      const mockResult = readMockStellarStake();
      if (mockResult !== undefined) {
        setData(undefined);
        setIsPending(true);
        setIsSuccess(false);
        setError(null);
        Promise.resolve().then(() => {
          setData(mockResult);
          setIsPending(false);
          setIsSuccess(true);
        });
        return;
      }

      // ── Unconfigured guard ────────────────────────────────────────────────
      if (!stakedPlusdId) {
        setError(new Error("StakedPLUSD not configured"));
        return;
      }

      // ── Disconnected guard ────────────────────────────────────────────────
      if (!isConnected || !address) {
        setError(new Error("Stellar wallet not connected"));
        return;
      }

      // ── Re-entrant guard ──────────────────────────────────────────────────
      if (isInFlight) return;

      setIsInFlight(true);
      setIsPending(true);
      setData(undefined);
      setIsSuccess(false);
      setError(null);

      void (async () => {
        try {
          const server = new rpc.Server(sorobanRpcUrl, {
            allowHttp: sorobanRpcUrl.startsWith("http://"),
          });
          const client = new StakedPlusdClient(stakedPlusdId);

          // 1. Fetch source account (sequence number).
          const sourceAccount = await server.getAccount(address);

          // 2. Build assembled (unsigned) transaction XDR.
          const assembledXdr = await client.buildDeposit(
            address,
            assetsRaw,
            address, // receiver = sender
            sourceAccount,
          );

          // 3. Sign via wallet.
          const { signedTxXdr } = await signTransaction(assembledXdr, {
            networkPassphrase: networkPassphrase as string,
            address,
          });

          // 4. Rebuild and submit.
          const signedTx = TransactionBuilder.fromXDR(
            signedTxXdr,
            networkPassphrase as string,
          );

          const sendResult = await server.sendTransaction(
            signedTx as Transaction,
          );

          if (sendResult.status === "ERROR") {
            throw new Error(
              `[stake] sendTransaction failed: status=ERROR hash=${sendResult.hash}`,
            );
          }

          // 5. Poll until terminal status.
          const finalResult = await server.pollTransaction(sendResult.hash);

          if (finalResult.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
            throw new Error(
              `[stake] Transaction ${sendResult.hash} failed with status ${finalResult.status}`,
            );
          }

          // 6. Optionally decode shares from returnValue.
          let sharesStr: string | undefined;
          if (finalResult.returnValue) {
            try {
              const native = scValToNative(finalResult.returnValue);
              const raw =
                typeof native === "bigint" ? native : BigInt(String(native));
              sharesStr = raw.toString();
            } catch {
              // Non-fatal — we have the hash, shares is optional metadata.
            }
          }

          setData({ hash: sendResult.hash, shares: sharesStr });
          setIsSuccess(true);
        } catch (err) {
          setError(err instanceof Error ? err : new Error(String(err)));
        } finally {
          setIsPending(false);
          setIsInFlight(false);
        }
      })();
    },
    [address, isConnected, isInFlight, signTransaction],
  );

  return { write, data, isPending, isSuccess, error, reset };
}

// ── useStellarUnstake ─────────────────────────────────────────────────────────

/**
 * Write hook for `redeem(shares, receiver, owner, operator) → assets`.
 *
 * Redeems sPLUSD shares from the FungibleVault, receiving PLUSD assets.
 * The sender acts as `owner` and `operator`.
 *
 * @example
 * ```tsx
 * const { write, data, isPending, isSuccess, error, reset } = useStellarUnstake();
 * // Unstake 1 sPLUSD (7 decimals: 10_000_000n)
 * write(10_000_000n);
 * ```
 */
export function useStellarUnstake(): StellarUnstakeResult {
  const [data, setData] = useState<
    { hash: string; assets?: string } | undefined
  >(undefined);
  const [isPending, setIsPending] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isInFlight, setIsInFlight] = useState(false);

  const { address, isConnected, signTransaction } = useStellarWallet();

  const reset = useCallback(() => {
    setData(undefined);
    setIsPending(false);
    setIsSuccess(false);
    setError(null);
  }, []);

  const write = useCallback(
    (sharesRaw: bigint) => {
      // ── Mock fast-path ────────────────────────────────────────────────────
      const mockResult = readMockStellarUnstake();
      if (mockResult !== undefined) {
        setData(undefined);
        setIsPending(true);
        setIsSuccess(false);
        setError(null);
        Promise.resolve().then(() => {
          setData(mockResult);
          setIsPending(false);
          setIsSuccess(true);
        });
        return;
      }

      // ── Unconfigured guard ────────────────────────────────────────────────
      if (!stakedPlusdId) {
        setError(new Error("StakedPLUSD not configured"));
        return;
      }

      // ── Disconnected guard ────────────────────────────────────────────────
      if (!isConnected || !address) {
        setError(new Error("Stellar wallet not connected"));
        return;
      }

      // ── Re-entrant guard ──────────────────────────────────────────────────
      if (isInFlight) return;

      setIsInFlight(true);
      setIsPending(true);
      setData(undefined);
      setIsSuccess(false);
      setError(null);

      void (async () => {
        try {
          const server = new rpc.Server(sorobanRpcUrl, {
            allowHttp: sorobanRpcUrl.startsWith("http://"),
          });
          const client = new StakedPlusdClient(stakedPlusdId);

          // 1. Fetch source account (sequence number).
          const sourceAccount = await server.getAccount(address);

          // 2. Build assembled (unsigned) transaction XDR.
          const assembledXdr = await client.buildRedeem(
            address,
            sharesRaw,
            address, // receiver = sender
            sourceAccount,
          );

          // 3. Sign via wallet.
          const { signedTxXdr } = await signTransaction(assembledXdr, {
            networkPassphrase: networkPassphrase as string,
            address,
          });

          // 4. Rebuild and submit.
          const signedTx = TransactionBuilder.fromXDR(
            signedTxXdr,
            networkPassphrase as string,
          );

          const sendResult = await server.sendTransaction(
            signedTx as Transaction,
          );

          if (sendResult.status === "ERROR") {
            throw new Error(
              `[unstake] sendTransaction failed: status=ERROR hash=${sendResult.hash}`,
            );
          }

          // 5. Poll until terminal status.
          const finalResult = await server.pollTransaction(sendResult.hash);

          if (finalResult.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
            throw new Error(
              `[unstake] Transaction ${sendResult.hash} failed with status ${finalResult.status}`,
            );
          }

          // 6. Optionally decode assets from returnValue.
          let assetsStr: string | undefined;
          if (finalResult.returnValue) {
            try {
              const native = scValToNative(finalResult.returnValue);
              const raw =
                typeof native === "bigint" ? native : BigInt(String(native));
              assetsStr = raw.toString();
            } catch {
              // Non-fatal — we have the hash, assets is optional metadata.
            }
          }

          setData({ hash: sendResult.hash, assets: assetsStr });
          setIsSuccess(true);
        } catch (err) {
          setError(err instanceof Error ? err : new Error(String(err)));
        } finally {
          setIsPending(false);
          setIsInFlight(false);
        }
      })();
    },
    [address, isConnected, isInFlight, signTransaction],
  );

  return { write, data, isPending, isSuccess, error, reset };
}

// ── useStellarStakedPlusdAsset ────────────────────────────────────────────────

/**
 * Reads `query_asset()` from the StakedPLUSD vault to get the underlying PLUSD
 * SAC contract ID.
 *
 * Cached forever — the underlying asset is immutable for a deployed vault.
 */
export function useStellarStakedPlusdAsset(): UseStellarStakedPlusdAssetResult {
  const isConfigured = !!stakedPlusdId;

  const query = useQuery<string, Error>({
    queryKey: ["stellarStakedPlusdAsset", stakedPlusdId],
    queryFn: async () => {
      const client = createStakedPlusdClient(stakedPlusdId);
      if (!client) throw new Error("StakedPLUSD not configured");
      return client.queryAsset();
    },
    enabled: isConfigured,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });

  if (!isConfigured) {
    return { plusdContractId: undefined, isLoading: false, error: null };
  }

  return {
    plusdContractId: query.data,
    isLoading: query.isLoading,
    error: query.error ?? null,
  };
}

// ── useStellarStakeConvertToShares ────────────────────────────────────────────

/**
 * Reads `convert_to_shares(assets)` — PLUSD → sPLUSD conversion preview.
 *
 * Mock convention: the `stakedPlusdConvertToShares` key holds a rate at SAC
 * 1e7 scale. Output = (assets * rate) / 1e7.
 * Example: rate `"9600000"` (= 0.96) → 1 PLUSD → 0.96 sPLUSD.
 *
 * @param assets - Raw i128 PLUSD amount at 7-decimal scale (or `undefined` to skip).
 */
export function useStellarStakeConvertToShares(
  assets: bigint | undefined,
): UseStellarConvertResult {
  // ── Mock fast-path (reactive) ─────────────────────────────────────────────
  const mockRate = useMock(
    STELLAR_MOCK_KEYS.stakedPlusdConvertToShares,
    parseBigInt,
  );

  const isConfigured = !!stakedPlusdId;

  const query = useQuery<bigint, Error>({
    queryKey: [
      "stellarStakedPlusdConvertToShares",
      stakedPlusdId,
      assets?.toString(),
    ],
    queryFn: async () => {
      // Re-read mock at query time.
      const rate = readMockStellarStakedPlusdConvertToShares();
      if (rate !== undefined && assets !== undefined) {
        return (assets * rate) / SAC_RATE_SCALE;
      }
      const client = createStakedPlusdClient(stakedPlusdId);
      if (!client) throw new Error("StakedPLUSD not configured");
      return client.convertToShares(assets!);
    },
    enabled: isConfigured && assets !== undefined && mockRate === undefined,
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: false,
  });

  // ── Mock path ─────────────────────────────────────────────────────────────
  if (mockRate !== undefined && assets !== undefined) {
    return {
      data: (assets * mockRate) / SAC_RATE_SCALE,
      isLoading: false,
      error: null,
    };
  }

  if (!isConfigured || assets === undefined) {
    return { data: undefined, isLoading: false, error: null };
  }

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error ?? null,
  };
}

// ── useStellarUnstakeConvertToAssets ──────────────────────────────────────────

/**
 * Reads `convert_to_assets(shares)` — sPLUSD → PLUSD conversion preview.
 *
 * Mock convention: the `stakedPlusdConvertToAssets` key holds a rate at SAC
 * 1e7 scale. Output = (shares * rate) / 1e7.
 * Example: rate `"10400000"` (= 1.04) → 1 sPLUSD → 1.04 PLUSD.
 *
 * @param shares - Raw i128 sPLUSD share amount at 7-decimal scale (or `undefined` to skip).
 */
export function useStellarUnstakeConvertToAssets(
  shares: bigint | undefined,
): UseStellarConvertResult {
  // ── Mock fast-path (reactive) ─────────────────────────────────────────────
  const mockRate = useMock(
    STELLAR_MOCK_KEYS.stakedPlusdConvertToAssets,
    parseBigInt,
  );

  const isConfigured = !!stakedPlusdId;

  const query = useQuery<bigint, Error>({
    queryKey: [
      "stellarStakedPlusdConvertToAssets",
      stakedPlusdId,
      shares?.toString(),
    ],
    queryFn: async () => {
      // Re-read mock at query time.
      const rate = readMockStellarStakedPlusdConvertToAssets();
      if (rate !== undefined && shares !== undefined) {
        return (shares * rate) / SAC_RATE_SCALE;
      }
      const client = createStakedPlusdClient(stakedPlusdId);
      if (!client) throw new Error("StakedPLUSD not configured");
      return client.convertToAssets(shares!);
    },
    enabled: isConfigured && shares !== undefined && mockRate === undefined,
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: false,
  });

  // ── Mock path ─────────────────────────────────────────────────────────────
  if (mockRate !== undefined && shares !== undefined) {
    return {
      data: (shares * mockRate) / SAC_RATE_SCALE,
      isLoading: false,
      error: null,
    };
  }

  if (!isConfigured || shares === undefined) {
    return { data: undefined, isLoading: false, error: null };
  }

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error ?? null,
  };
}

// ── useStellarStakedPlusdBalance ──────────────────────────────────────────────

/**
 * Reads `balance(account)` from the StakedPLUSD vault to get the LP's sPLUSD
 * share balance. Since the vault IS the share token, this is the sPLUSD balance.
 *
 * Returns `undefined` when disconnected or unconfigured.
 * Polls every 30 seconds while connected.
 */
export function useStellarStakedPlusdBalance(): UseStellarStakedPlusdBalanceResult {
  const { address, isConnected } = useStellarWallet();

  // ── Mock fast-path (reactive) ─────────────────────────────────────────────
  const mockBalance = useMock(
    STELLAR_MOCK_KEYS.stakedPlusdShareBalance,
    parseBigInt,
  );

  const isConfigured = !!stakedPlusdId;

  const query = useQuery<bigint, Error>({
    queryKey: ["stellarStakedPlusdBalance", stakedPlusdId, address],
    queryFn: async () => {
      // Re-read mock at query time.
      const mock = readMockStellarStakedPlusdShareBalance();
      if (mock !== undefined) return mock;

      const client = createStakedPlusdClient(stakedPlusdId);
      if (!client) throw new Error("StakedPLUSD not configured");
      return client.balance(address!);
    },
    enabled:
      isConfigured && isConnected && !!address && mockBalance === undefined,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: false,
  });

  // ── Mock path ─────────────────────────────────────────────────────────────
  if (mockBalance !== undefined) {
    return {
      balance: mockBalance,
      isLoading: false,
      error: null,
      refetch: () => {},
    };
  }

  if (!isConnected || !address || !isConfigured) {
    return {
      balance: undefined,
      isLoading: false,
      error: null,
      refetch: () => {},
    };
  }

  return {
    balance: query.data,
    isLoading: query.isLoading,
    error: query.error ?? null,
    refetch: () => void query.refetch(),
  };
}

// ── useStellarChangeTrustStakedPlusd ──────────────────────────────────────────

/**
 * Hook that builds and submits a classic `changeTrust` op for the sPLUSD asset.
 *
 * Staking mints sPLUSD shares to the receiver — without an sPLUSD trustline
 * the deposit fails. This hook derives the share asset's `{ code, issuer }`
 * from the vault's `name()` view (which returns `"sPLUSD:GISSUER"` style,
 * matching the `"CODE:ISSUER"` convention used for PLUSD/USDC in
 * `useStellarDepositManagerAddresses.ts`), then drives `useStellarSacToken`
 * for `hasTrustline` detection.
 *
 * Fail-safe status (`trustlineStatus`)
 * --------------------------------------
 * The hook exposes a discriminated status instead of a simple boolean so that
 * consumers can distinguish between "trustline confirmed present" and any
 * loading/error/missing state. This prevents the step from silently showing
 * "success" while the share asset is still resolving:
 *
 *   - `"loading"` — share asset or token check is still in flight.
 *   - `"error"`   — `name()` call failed or returned an unexpected format.
 *   - `"needed"`  — share asset resolved, but the trustline is missing.
 *   - `"satisfied"` — share asset resolved AND the trustline exists.
 *
 * The step must only be marked "success" and staking may only proceed when
 * `trustlineStatus === "satisfied"`. Any other status (including loading)
 * keeps the step actionable ("Enable" button) and blocks the stake action.
 *
 * `needsTrustline` is kept for backward-compat and is `true` only for the
 * "needed" case (enables the submit button when there is a real missing trustline
 * to act on).
 *
 * Uses Horizon (not Soroban RPC) for submission — classic ops go to Horizon.
 * The `shareAssetQuery` does not retry (`retry: false`) so a transient RPC
 * failure surfaces immediately as `trustlineStatus: "error"`. The user
 * recovers by reconnecting (which re-triggers the query) or by refreshing.
 */
export function useStellarChangeTrustStakedPlusd(): UseStellarChangeTrustStakedPlusdResult {
  const [data, setData] = useState<{ hash: string } | undefined>(undefined);
  const [isPending, setIsPending] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isInFlight, setIsInFlight] = useState(false);

  const { address, isConnected, signTransaction } = useStellarWallet();

  // ── Resolve share asset { code, issuer } from vault name() ─────────────────
  //
  // The vault's SAC name() returns "CODE:ISSUER" style (e.g. "sPLUSD:GISSUER"),
  // matching the convention used for PLUSD/USDC in
  // useStellarDepositManagerAddresses.ts (parseClassicAsset). On an unexpected
  // format we throw (fail-safe) rather than fabricating an issuer, because
  // building a changeTrust against a wrong asset is worse than blocking.
  // retry:1 allows one self-heal on a transient RPC error.
  const shareAssetQuery = useQuery<{ code: string; issuer: string }, Error>({
    queryKey: ["stellarStakedPlusdShareAsset", stakedPlusdId],
    queryFn: async () => {
      const client = createStakedPlusdClient(stakedPlusdId);
      if (!client) throw new Error("StakedPLUSD not configured");
      const nameStr = await client.name();
      // Parse "CODE:ISSUER" — same pattern as parseClassicAsset in
      // useStellarDepositManagerAddresses.ts.
      const parts = nameStr.split(":");
      if (parts.length === 2 && parts[0] && parts[1]) {
        return { code: parts[0], issuer: parts[1] };
      }
      // Fail-safe: treat unexpected format as an error so trustlineStatus
      // becomes "error" and staking is blocked (not silently allowed).
      console.warn(
        `useStellarChangeTrustStakedPlusd: unexpected name() result "${nameStr}", expected "CODE:ISSUER"`,
      );
      throw new Error(
        `StakedPLUSD: unexpected name() result "${nameStr}" — expected "CODE:ISSUER"`,
      );
    },
    enabled: !!stakedPlusdId,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    // retry:false — fail fast so trustlineStatus flips to "error" immediately
    // on an RPC hiccup. The user recovers by reconnecting (which triggers a
    // new render and re-enables the query) or by refreshing the page.
    retry: false,
  });

  const shareAsset = shareAssetQuery.data;

  // ── Trustline check via useStellarSacToken ─────────────────────────────────
  const sPlusdToken = useStellarSacToken({
    assetCode: shareAsset?.code ?? "",
    assetIssuer: shareAsset?.issuer ?? "",
    contractId: stakedPlusdId, // vault IS the share token
    mockKey: STELLAR_MOCK_KEYS.stakedPlusdShareBalance,
  });

  // ── Fail-safe trustline status ─────────────────────────────────────────────
  //
  // "satisfied" is the ONLY state that allows staking to proceed and the step
  // to be marked "success". All other states keep the step actionable.
  const trustlineStatus: StellarSplusdTrustlineStatus = (() => {
    if (!isConnected) {
      // Disconnected: no trustline to verify — keep as loading so the step
      // is never shown as satisfied for a disconnected user.
      return "loading";
    }
    if (shareAssetQuery.isLoading || sPlusdToken.isLoading) {
      return "loading";
    }
    if (shareAssetQuery.error !== null) {
      return "error";
    }
    if (!shareAsset) {
      // Query finished but no data (e.g. unconfigured) — treat as loading
      // rather than silently OK.
      return "loading";
    }
    if (sPlusdToken.hasTrustline) {
      return "satisfied";
    }
    return "needed";
  })();

  // needsTrustline kept for backward-compat: true only for the actionable
  // "I need to add a trustline" case. Loading/error do NOT set this true so
  // the button is disabled while resolution is pending.
  const needsTrustline = trustlineStatus === "needed";

  const reset = useCallback(() => {
    setData(undefined);
    setIsPending(false);
    setIsSuccess(false);
    setError(null);
  }, []);

  const submit = useCallback(() => {
    // ── Mock fast-path ────────────────────────────────────────────────────
    const mockResult = readMockStellarChangeTrustStakedPlusd();
    if (mockResult !== undefined) {
      setData(undefined);
      setIsPending(true);
      setIsSuccess(false);
      setError(null);
      Promise.resolve().then(() => {
        setData(mockResult);
        setIsPending(false);
        setIsSuccess(true);
      });
      return;
    }

    // ── Unconfigured guard ────────────────────────────────────────────────
    if (!stakedPlusdId) {
      setError(new Error("StakedPLUSD not configured"));
      return;
    }

    // ── Disconnected guard ────────────────────────────────────────────────
    if (!isConnected || !address) {
      setError(new Error("Stellar wallet not connected"));
      return;
    }

    // ── Share asset not loaded yet ────────────────────────────────────────
    if (!shareAsset) {
      setError(new Error("sPLUSD share asset not loaded"));
      return;
    }

    // ── Re-entrant guard ──────────────────────────────────────────────────
    if (isInFlight) return;

    setIsInFlight(true);
    setIsPending(true);
    setData(undefined);
    setIsSuccess(false);
    setError(null);

    void (async () => {
      try {
        const horizon = new Horizon.Server(horizonUrl);

        // 1. Load account from Horizon for the transaction fee + sequence.
        const account = await horizon.loadAccount(address);

        // 2. Build the changeTrust transaction for sPLUSD.
        const asset = new Asset(shareAsset.code, shareAsset.issuer);
        const tx = new TransactionBuilder(account, {
          fee: "100",
          networkPassphrase: networkPassphrase as string,
        })
          .addOperation(Operation.changeTrust({ asset }))
          .setTimeout(30)
          .build();

        // 3. Sign via wallet.
        const { signedTxXdr } = await signTransaction(tx.toXDR(), {
          networkPassphrase: networkPassphrase as string,
          address,
        });

        // 4. Rebuild and submit to Horizon.
        const signedTx = TransactionBuilder.fromXDR(
          signedTxXdr,
          networkPassphrase as string,
        );

        const submitResult = await horizon.submitTransaction(
          signedTx as Transaction,
        );

        setData({ hash: submitResult.hash });
        setIsSuccess(true);
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        setIsPending(false);
        setIsInFlight(false);
      }
    })();
  }, [address, isConnected, isInFlight, shareAsset, signTransaction]);

  return {
    submit,
    trustlineStatus,
    needsTrustline,
    data,
    isPending,
    isSuccess,
    error,
    reset,
  };
}
