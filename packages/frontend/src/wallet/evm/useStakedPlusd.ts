/**
 * StakedPLUSD (sPLUSD) ERC-4626 vault wallet hooks.
 *
 * Provides `useStakedPlusdAsset`, `useStakedPlusdConvertToShares`,
 * `useStakedPlusdConvertToAssets`, `useStake`, and `useUnstake` — the
 * on-chain interactions exposed by the sPLUSD ERC-4626 vault.
 *
 * Mock-key precedence (same pattern as useWithdrawalQueue):
 *   1. Named-alias mock keys (`pipeline.mock.wallet.contract.stakedPlusd.*`).
 *   2. Generic per-address mock keys (`pipeline.mock.wallet.contract.<addr>.*`).
 *   3. Zero-address short-circuit — hooks return `undefined` data without any
 *      RPC call when `VITE_STAKED_PLUSD_ADDRESS` is the zero address.
 *   4. Real wagmi / viem calls.
 *
 * Rate-based convert mock convention:
 *   The `convertToShares` and `convertToAssets` mock keys hold a single
 *   18-decimal rate (a bigint string at 1e18 scale) rather than a per-amount
 *   lookup. Given rate `r` and input `n`, the output is `(n * r) / 1e18`.
 *   Example: rate `"959600000000000000"` (= 0.9596 at 1e18) means:
 *     - `convertToShares(1_000_000_000_000_000_000n)` → `959_600_000_000_000_000n`
 *     - `convertToShares(500_000_000_000_000_000n)` → `479_800_000_000_000_000n`
 *   This keeps mock scenarios small — one rate key covers any input amount.
 *
 * Important: the `shares?` and `assets?` fields in write hook `data` are
 * **mock-path only**. On the real wagmi path, `data` contains only `{ hash }`
 * because `useWriteContract` only resolves to a tx hash — it does not decode
 * the receipt return value. This mirrors `useRequestWithdrawal`'s behaviour.
 *
 * Two distinct error branches for the write hooks:
 *   - `Error("Wallet not connected")` — UI state (no wallet connected).
 *   - `Error("StakedPLUSD not configured")` — env state (zero address).
 */
import { useState, useCallback } from "react";
import { useReadContract, useWriteContract, usePublicClient } from "wagmi";
import { ENV } from "@/lib/env";
import {
  useMock,
  readMock,
  parseAddress,
  parseJson,
  parseBigInt,
} from "./mock";
import { stakedPlusdAbi } from "./abis/stakedPlusd";
import { CACHE_FOREVER } from "./cache";
import { useEvmWallet } from "./useEvmWallet";
import { estimateGasCapped } from "./estimateGas";
import { simulateOrFail } from "./simulate";

// ── Mock-key constants ────────────────────────────────────────────────────────

const MOCK_KEYS = {
  /** Named alias for `useStakedPlusdAsset` — takes precedence over the generic key. */
  assetAlias: "pipeline.mock.wallet.contract.stakedPlusd.asset",
  /** Named alias for `useStakedPlusdConvertToShares` — rate scalar at 1e18. */
  convertToSharesAlias:
    "pipeline.mock.wallet.contract.stakedPlusd.convertToShares",
  /** Named alias for `useStakedPlusdConvertToAssets` — rate scalar at 1e18. */
  convertToAssetsAlias:
    "pipeline.mock.wallet.contract.stakedPlusd.convertToAssets",
  /** Named alias for `useStake` — JSON `{ hash: "0x…", shares?: "1000000000000000000" }`. */
  stake: "pipeline.mock.wallet.contract.stakedPlusd.stake",
  /** Named alias for `useUnstake` — JSON `{ hash: "0x…", assets?: "1000000000000000000" }`. */
  unstake: "pipeline.mock.wallet.contract.stakedPlusd.unstake",
  /** Generic per-address key for `asset()`. */
  contractAsset: (address: string) =>
    `pipeline.mock.wallet.contract.${address.toLowerCase()}.asset`,
  /** Generic per-address key for `convertToShares()` — rate scalar at 1e18. */
  contractConvertToShares: (address: string) =>
    `pipeline.mock.wallet.contract.${address.toLowerCase()}.convertToShares`,
  /** Generic per-address key for `convertToAssets()` — rate scalar at 1e18. */
  contractConvertToAssets: (address: string) =>
    `pipeline.mock.wallet.contract.${address.toLowerCase()}.convertToAssets`,
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Scale factor for rate-based convert mock arithmetic. */
const RATE_SCALE = 10n ** 18n;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StakedPlusdAssetResult {
  plusd: `0x${string}` | undefined;
  isLoading: boolean;
  error: Error | null;
}

export interface StakedPlusdConvertResult {
  data: bigint | undefined;
  isLoading: boolean;
  error: Error | null;
}

export interface StakeResult {
  write: (amount: bigint) => void;
  data: { hash: string; shares?: string } | undefined;
  isPending: boolean;
  isSuccess: boolean;
  error: Error | null;
  reset: () => void;
}

export interface UnstakeResult {
  write: (shares: bigint) => void;
  data: { hash: string; assets?: string } | undefined;
  isPending: boolean;
  isSuccess: boolean;
  error: Error | null;
  reset: () => void;
}

// ── useStakedPlusdAsset ───────────────────────────────────────────────────────

/**
 * Reads the `asset()` (→ PLUSD) view function from the StakedPLUSD vault.
 *
 * Per the ERC-4626 spec, `asset()` is the underlying ERC-20 that the vault
 * wraps — always PLUSD. It is immutable for the deployed proxy, so the result
 * is cached forever (`staleTime: Infinity`).
 *
 * Priority order:
 *   1. Named-alias mock key (`pipeline.mock.wallet.contract.stakedPlusd.asset`).
 *   2. Generic per-address mock key (`pipeline.mock.wallet.contract.<addr>.asset`).
 *   3. Zero-address short-circuit — returns `undefined` without making an RPC call.
 *   4. Real `useReadContract` call with "fetch once per page lifetime" caching.
 *
 * Returns `{ plusd, isLoading, error }` where `plusd` is the PLUSD token address.
 */
export function useStakedPlusdAsset(): StakedPlusdAssetResult {
  // Named-alias mock key (reactive via useSyncExternalStore).
  const mockAsset = useMock(MOCK_KEYS.assetAlias, parseAddress);

  const SP_ADDRESS = ENV.STAKED_PLUSD_ADDRESS;
  const isZeroAddress = SP_ADDRESS === ZERO_ADDRESS;

  // Generic per-address mock key (read once per render).
  const mockAssetGeneric = readMock(
    MOCK_KEYS.contractAsset(SP_ADDRESS),
    parseAddress,
  );

  const hasMock = mockAsset !== undefined || mockAssetGeneric !== undefined;
  const shouldSkipReal = hasMock || isZeroAddress;

  const assetRead = useReadContract({
    address: SP_ADDRESS,
    abi: stakedPlusdAbi,
    functionName: "asset",
    query: { enabled: !shouldSkipReal, ...CACHE_FOREVER },
  });

  // Named alias takes priority over generic key.
  if (mockAsset !== undefined) {
    return {
      plusd: mockAsset,
      isLoading: false,
      error: null,
    };
  }

  // Generic per-address key.
  if (mockAssetGeneric !== undefined) {
    return {
      plusd: mockAssetGeneric,
      isLoading: false,
      error: null,
    };
  }

  // Zero-address short-circuit.
  if (isZeroAddress) {
    return {
      plusd: undefined,
      isLoading: false,
      error: null,
    };
  }

  // Real RPC path.
  return {
    plusd: assetRead.data as `0x${string}` | undefined,
    isLoading: assetRead.isLoading,
    error: assetRead.error as Error | null,
  };
}

// ── useStakedPlusdConvertToShares ─────────────────────────────────────────────

/**
 * Reads `convertToShares(uint256 assets)` from the StakedPLUSD vault.
 *
 * "If I deposit `assets` PLUSD, how many sPLUSD shares do I get?"
 * Used for the deposit (stake) preview on the Stake page.
 *
 * Pass `undefined` or `0n` → hook is disabled, no RPC call, `data === undefined`.
 *
 * Mock-path rate convention:
 *   The mock key holds a single 18-decimal rate scalar. Given rate `r` and
 *   input `n`, the output is `(n * r) / 1e18`.
 *   Example: rate `"959600000000000000"` → 0.9596 sPLUSD per 1 PLUSD.
 *
 * Caching: short stale time (`staleTime: 30_000`, `refetchInterval: 30_000`)
 * so the rate updates while the user is on the page as yield accrues.
 */
export function useStakedPlusdConvertToShares(
  assets: bigint | undefined,
): StakedPlusdConvertResult {
  const SP_ADDRESS = ENV.STAKED_PLUSD_ADDRESS;
  const isZeroAddress = SP_ADDRESS === ZERO_ADDRESS;
  const inputDisabled = assets === undefined || assets === 0n;

  // Named-alias rate mock (reactive).
  const mockRateNamed = useMock(MOCK_KEYS.convertToSharesAlias, parseBigInt);
  // Generic per-address rate mock (read once per render).
  const mockRateGeneric = readMock(
    MOCK_KEYS.contractConvertToShares(SP_ADDRESS),
    parseBigInt,
  );

  const mockRate = mockRateNamed ?? mockRateGeneric;
  const hasMock = mockRate !== undefined;
  const shouldSkipReal = hasMock || isZeroAddress || inputDisabled;

  const convertRead = useReadContract({
    address: SP_ADDRESS,
    abi: stakedPlusdAbi,
    functionName: "convertToShares",
    args: [assets ?? 0n],
    query: {
      enabled: !shouldSkipReal,
      staleTime: 30_000,
      refetchInterval: 30_000,
    },
  });

  // Disabled input → return immediately without data.
  if (inputDisabled) {
    return { data: undefined, isLoading: false, error: null };
  }

  // Zero-address short-circuit.
  if (isZeroAddress) {
    return { data: undefined, isLoading: false, error: null };
  }

  // Mock-path rate maths: (input * rate) / 1e18.
  if (hasMock) {
    return {
      data: (assets * mockRate) / RATE_SCALE,
      isLoading: false,
      error: null,
    };
  }

  // Real RPC path.
  return {
    data: convertRead.data as bigint | undefined,
    isLoading: convertRead.isLoading,
    error: convertRead.error as Error | null,
  };
}

// ── useStakedPlusdConvertToAssets ─────────────────────────────────────────────

/**
 * Reads `convertToAssets(uint256 shares)` from the StakedPLUSD vault.
 *
 * "If I redeem `shares` sPLUSD, how much PLUSD do I get?"
 * Used for the redeem (unstake) preview on the Stake page.
 *
 * Pass `undefined` or `0n` → hook is disabled, no RPC call, `data === undefined`.
 *
 * Mock-path rate convention:
 *   The mock key holds a single 18-decimal inverse rate scalar. Given rate `r`
 *   and input `n`, the output is `(n * r) / 1e18`.
 *   Example: rate `"1042100000000000000"` → 1.0421 PLUSD per 1 sPLUSD.
 *
 * Caching: same as `useStakedPlusdConvertToShares` (`staleTime: 30_000`,
 * `refetchInterval: 30_000`).
 */
export function useStakedPlusdConvertToAssets(
  shares: bigint | undefined,
): StakedPlusdConvertResult {
  const SP_ADDRESS = ENV.STAKED_PLUSD_ADDRESS;
  const isZeroAddress = SP_ADDRESS === ZERO_ADDRESS;
  const inputDisabled = shares === undefined || shares === 0n;

  // Named-alias rate mock (reactive).
  const mockRateNamed = useMock(MOCK_KEYS.convertToAssetsAlias, parseBigInt);
  // Generic per-address rate mock (read once per render).
  const mockRateGeneric = readMock(
    MOCK_KEYS.contractConvertToAssets(SP_ADDRESS),
    parseBigInt,
  );

  const mockRate = mockRateNamed ?? mockRateGeneric;
  const hasMock = mockRate !== undefined;
  const shouldSkipReal = hasMock || isZeroAddress || inputDisabled;

  const convertRead = useReadContract({
    address: SP_ADDRESS,
    abi: stakedPlusdAbi,
    functionName: "convertToAssets",
    args: [shares ?? 0n],
    query: {
      enabled: !shouldSkipReal,
      staleTime: 30_000,
      refetchInterval: 30_000,
    },
  });

  // Disabled input → return immediately without data.
  if (inputDisabled) {
    return { data: undefined, isLoading: false, error: null };
  }

  // Zero-address short-circuit.
  if (isZeroAddress) {
    return { data: undefined, isLoading: false, error: null };
  }

  // Mock-path rate maths: (input * rate) / 1e18.
  if (hasMock) {
    return {
      data: (shares * mockRate) / RATE_SCALE,
      isLoading: false,
      error: null,
    };
  }

  // Real RPC path.
  return {
    data: convertRead.data as bigint | undefined,
    isLoading: convertRead.isLoading,
    error: convertRead.error as Error | null,
  };
}

// ── useStake ──────────────────────────────────────────────────────────────────

/**
 * Write hook for `deposit(uint256 assets, address receiver) → uint256 shares`.
 *
 * User specifies PLUSD amount (`assets`). `receiver` defaults to the connected
 * wallet (applied internally — not exposed as a hook arg, same ergonomic choice
 * as `useRequestDeposit`).
 *
 * Mock key `pipeline.mock.wallet.contract.stakedPlusd.stake`:
 *   JSON-encoded `{ hash: "0x...", shares?: "1000000000000000000" }` — when set,
 *   `write()` returns immediately with that object and no RPC call is issued.
 *
 * Error guards (two distinct branches):
 *   - `Error("Wallet not connected")` — address is undefined (no wallet).
 *   - `Error("StakedPLUSD not configured")` — env address is the zero address.
 *
 * Note: `shares?` is **mock-path only**. On the real wagmi path `useWriteContract`
 * only resolves to a tx hash — it does not decode the receipt return value.
 *
 * Note: for write hooks we check the mock key inside the `write` callback
 * (via `readMock`) rather than tracking it reactively. This avoids the
 * `useSyncExternalStore` "getSnapshot should be cached" warning that arises
 * when `parseJson` returns a new object on every render.
 */
export function useStake(): StakeResult {
  const SP_ADDRESS = ENV.STAKED_PLUSD_ADDRESS;
  const isZeroAddress = SP_ADDRESS === ZERO_ADDRESS;

  const { address } = useEvmWallet();

  // Detect whether the mock key is present (non-reactive check).
  const hasMockKey = readMock(MOCK_KEYS.stake, parseJson) !== undefined;

  // Mock state for mock-key path.
  const [mockState, setMockState] = useState<{
    data: { hash: string; shares?: string } | undefined;
    isPending: boolean;
    isSuccess: boolean;
    error: Error | null;
  }>({ data: undefined, isPending: false, isSuccess: false, error: null });

  // Zero-address / wallet-not-connected / estimation error state.
  const [writeError, setWriteError] = useState<Error | null>(null);

  // Estimation in-flight flag — allows isPending to be true during estimation
  // and guards against re-entrant write calls.
  const [isEstimating, setIsEstimating] = useState(false);

  // Wagmi write hook — always called (hooks must not be conditional).
  const wagmiWrite = useWriteContract();

  // Public client for gas estimation — always called (hooks must not be conditional).
  const publicClient = usePublicClient();

  const resetMock = useCallback(() => {
    setMockState({
      data: undefined,
      isPending: false,
      isSuccess: false,
      error: null,
    });
    setWriteError(null);
  }, []);

  const write = useCallback(
    (amount: bigint) => {
      // Re-read mock key at call time to pick up any dynamic changes.
      const mockRaw = readMock(
        MOCK_KEYS.stake,
        parseJson<{ hash: string; shares?: string }>,
      );

      if (mockRaw !== undefined) {
        // Mock key present — return parsed result without RPC.
        setMockState({
          data: undefined,
          isPending: true,
          isSuccess: false,
          error: null,
        });
        // Settle in the next microtask so isPending:true is observable.
        Promise.resolve().then(() => {
          setMockState({
            data: mockRaw,
            isPending: false,
            isSuccess: true,
            error: null,
          });
        });
        return;
      }

      if (address === undefined) {
        setWriteError(new Error("Wallet not connected"));
        return;
      }

      if (isZeroAddress) {
        setWriteError(new Error("StakedPLUSD not configured"));
        return;
      }

      // Guard re-entrant calls while estimation is in flight.
      if (isEstimating) return;

      void (async () => {
        setIsEstimating(true);
        const simulated = await simulateOrFail({
          publicClient,
          account: address,
          abi: stakedPlusdAbi,
          address: SP_ADDRESS,
          functionName: "deposit",
          args: [amount, address],
        });
        if (!simulated.ok) {
          setIsEstimating(false);
          setWriteError(simulated.error);
          return;
        }

        const result = await estimateGasCapped({
          publicClient,
          account: address,
          abi: stakedPlusdAbi,
          address: SP_ADDRESS,
          functionName: "deposit",
          args: [amount, address],
        });
        setIsEstimating(false);

        if (!result.ok) {
          setWriteError(result.error);
          return;
        }

        wagmiWrite.writeContract({
          abi: stakedPlusdAbi,
          address: SP_ADDRESS,
          functionName: "deposit",
          args: [amount, address],
          gas: result.gas,
        });
      })();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      address,
      isZeroAddress,
      isEstimating,
      SP_ADDRESS,
      publicClient,
      wagmiWrite.writeContract,
    ],
  );

  if (hasMockKey) {
    return {
      write,
      data: mockState.data,
      isPending: mockState.isPending,
      isSuccess: mockState.isSuccess,
      error: mockState.error,
      reset: resetMock,
    };
  }

  if (address === undefined || isZeroAddress) {
    return {
      write,
      data: undefined,
      isPending: false,
      isSuccess: false,
      error: writeError,
      reset: () => setWriteError(null),
    };
  }

  // Real wagmi path.
  const txHash = wagmiWrite.data;
  return {
    write,
    data: txHash !== undefined ? { hash: txHash } : undefined,
    isPending: isEstimating || wagmiWrite.isPending,
    isSuccess: wagmiWrite.isSuccess,
    error: (writeError ?? wagmiWrite.error) as Error | null,
    reset: () => {
      setWriteError(null);
      wagmiWrite.reset();
    },
  };
}

// ── useUnstake ────────────────────────────────────────────────────────────────

/**
 * Write hook for `redeem(uint256 shares, address receiver, address owner) → uint256 assets`.
 *
 * User specifies sPLUSD amount to burn (`shares`). Both `receiver` and `owner`
 * default to the connected wallet (applied internally — not exposed as hook args).
 * No verifier signature required — unstaking is a direct on-chain ERC-4626
 * transition (unlike `WithdrawalQueue.claimWithdrawal`).
 *
 * Mock key `pipeline.mock.wallet.contract.stakedPlusd.unstake`:
 *   JSON-encoded `{ hash: "0x...", assets?: "1000000000000000000" }` — when set,
 *   `write()` returns immediately with that object and no RPC call is issued.
 *
 * Error guards (two distinct branches):
 *   - `Error("Wallet not connected")` — address is undefined (no wallet).
 *   - `Error("StakedPLUSD not configured")` — env address is the zero address.
 *
 * Note: `assets?` is **mock-path only**. On the real wagmi path `useWriteContract`
 * only resolves to a tx hash — it does not decode the receipt return value.
 */
export function useUnstake(): UnstakeResult {
  const SP_ADDRESS = ENV.STAKED_PLUSD_ADDRESS;
  const isZeroAddress = SP_ADDRESS === ZERO_ADDRESS;

  const { address } = useEvmWallet();

  // Detect whether the mock key is present (non-reactive check).
  const hasMockKey = readMock(MOCK_KEYS.unstake, parseJson) !== undefined;

  // Mock state for mock-key path.
  const [mockState, setMockState] = useState<{
    data: { hash: string; assets?: string } | undefined;
    isPending: boolean;
    isSuccess: boolean;
    error: Error | null;
  }>({ data: undefined, isPending: false, isSuccess: false, error: null });

  // Zero-address / wallet-not-connected / estimation error state.
  const [writeError, setWriteError] = useState<Error | null>(null);

  // Estimation in-flight flag — allows isPending to be true during estimation
  // and guards against re-entrant write calls.
  const [isEstimating, setIsEstimating] = useState(false);

  // Wagmi write hook — always called (hooks must not be conditional).
  const wagmiWrite = useWriteContract();

  // Public client for gas estimation — always called (hooks must not be conditional).
  const publicClient = usePublicClient();

  const resetMock = useCallback(() => {
    setMockState({
      data: undefined,
      isPending: false,
      isSuccess: false,
      error: null,
    });
    setWriteError(null);
  }, []);

  const write = useCallback(
    (shares: bigint) => {
      // Re-read mock key at call time to pick up any dynamic changes.
      const mockRaw = readMock(
        MOCK_KEYS.unstake,
        parseJson<{ hash: string; assets?: string }>,
      );

      if (mockRaw !== undefined) {
        // Mock key present — return parsed result without RPC.
        setMockState({
          data: undefined,
          isPending: true,
          isSuccess: false,
          error: null,
        });
        // Settle in the next microtask so isPending:true is observable.
        Promise.resolve().then(() => {
          setMockState({
            data: mockRaw,
            isPending: false,
            isSuccess: true,
            error: null,
          });
        });
        return;
      }

      if (address === undefined) {
        setWriteError(new Error("Wallet not connected"));
        return;
      }

      if (isZeroAddress) {
        setWriteError(new Error("StakedPLUSD not configured"));
        return;
      }

      // Guard re-entrant calls while estimation is in flight.
      if (isEstimating) return;

      void (async () => {
        setIsEstimating(true);
        const simulated = await simulateOrFail({
          publicClient,
          account: address,
          abi: stakedPlusdAbi,
          address: SP_ADDRESS,
          functionName: "redeem",
          args: [shares, address, address],
        });
        if (!simulated.ok) {
          setIsEstimating(false);
          setWriteError(simulated.error);
          return;
        }

        const result = await estimateGasCapped({
          publicClient,
          account: address,
          abi: stakedPlusdAbi,
          address: SP_ADDRESS,
          functionName: "redeem",
          args: [shares, address, address],
        });
        setIsEstimating(false);

        if (!result.ok) {
          setWriteError(result.error);
          return;
        }

        wagmiWrite.writeContract({
          abi: stakedPlusdAbi,
          address: SP_ADDRESS,
          functionName: "redeem",
          args: [shares, address, address],
          gas: result.gas,
        });
      })();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      address,
      isZeroAddress,
      isEstimating,
      SP_ADDRESS,
      publicClient,
      wagmiWrite.writeContract,
    ],
  );

  if (hasMockKey) {
    return {
      write,
      data: mockState.data,
      isPending: mockState.isPending,
      isSuccess: mockState.isSuccess,
      error: mockState.error,
      reset: resetMock,
    };
  }

  if (address === undefined || isZeroAddress) {
    return {
      write,
      data: undefined,
      isPending: false,
      isSuccess: false,
      error: writeError,
      reset: () => setWriteError(null),
    };
  }

  // Real wagmi path.
  const txHash = wagmiWrite.data;
  return {
    write,
    data: txHash !== undefined ? { hash: txHash } : undefined,
    isPending: isEstimating || wagmiWrite.isPending,
    isSuccess: wagmiWrite.isSuccess,
    error: (writeError ?? wagmiWrite.error) as Error | null,
    reset: () => {
      setWriteError(null);
      wagmiWrite.reset();
    },
  };
}
