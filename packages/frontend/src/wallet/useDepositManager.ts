/**
 * DepositManager wallet hooks.
 *
 * Provides `useDepositManagerAddresses`, `useDepositManagerMinDeposit`,
 * `useRequestDeposit`, and `useClaim` — the on-chain interactions exposed by
 * the DepositManager contract.
 *
 * Each hook consults the `pipeline.mock.wallet.contract.depositManager.*`
 * localStorage layer first; when a mock key is present the real wagmi call is
 * skipped entirely (no network request).
 */
import { useState, useCallback } from "react";
import { useReadContract, useWriteContract } from "wagmi";
import { ENV } from "@/lib/env";
import {
  useMock,
  readMock,
  parseAddress,
  parseBigInt,
  parseJson,
} from "./mock";
import { depositManagerAbi } from "./abis/depositManager";
import { CACHE_FOREVER } from "./cache";

// ── Mock-key constants ────────────────────────────────────────────────────────

const MOCK_KEYS = {
  /** Named alias — takes precedence over the generic per-address key. */
  plusdAlias: "pipeline.mock.wallet.contract.depositManager.plusd",
  usdcAlias: "pipeline.mock.wallet.contract.depositManager.usdc",
  minDepositAlias: "pipeline.mock.wallet.contract.depositManager.minDeposit",
  requestDeposit: "pipeline.mock.wallet.contract.depositManager.requestDeposit",
  claim: "pipeline.mock.wallet.contract.depositManager.claim",
  /** Generic per-address key for `useContractRead` compatibility. */
  contractPlUsd: (address: string) =>
    `pipeline.mock.wallet.contract.${address.toLowerCase()}.plUsd`,
  contractUsdc: (address: string) =>
    `pipeline.mock.wallet.contract.${address.toLowerCase()}.usdc`,
  contractMinDeposit: (address: string) =>
    `pipeline.mock.wallet.contract.${address.toLowerCase()}.minDeposit`,
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DepositManagerAddressesResult {
  plusd: `0x${string}` | undefined;
  usdc: `0x${string}` | undefined;
  isLoading: boolean;
  error: Error | null;
}

export interface RequestDepositResult {
  write: (amount: bigint) => void;
  data: { hash: string; requestId?: string } | undefined;
  isPending: boolean;
  isSuccess: boolean;
  error: Error | null;
  reset: () => void;
}

export interface ClaimResult {
  write: (requestId: bigint, verifierSignature: `0x${string}`) => void;
  data: { hash: string; amount?: string } | undefined;
  isPending: boolean;
  isSuccess: boolean;
  error: Error | null;
  reset: () => void;
}

export interface DepositManagerMinDepositResult {
  minDeposit: bigint | undefined;
  isLoading: boolean;
  error: Error | null;
}

// ── useDepositManagerAddresses ─────────────────────────────────────────────────

/**
 * Reads the `plUsd()` and `usdc()` view functions from the DepositManager
 * contract.
 *
 * Priority order:
 *   1. Named-alias mock keys (`pipeline.mock.wallet.contract.depositManager.plusd`
 *      / `…usdc`).
 *   2. Generic per-address mock keys (`pipeline.mock.wallet.contract.<addr>.plUsd`
 *      / `…usdc`).
 *   3. Zero-address short-circuit — returns `undefined` data without making an
 *      RPC call.
 *   4. Real `useReadContract` calls with "fetch once per page lifetime" caching.
 */
export function useDepositManagerAddresses(): DepositManagerAddressesResult {
  // Named-alias mock keys (reactive via useSyncExternalStore; address strings
  // are primitives so getSnapshot always returns a stable value or undefined).
  const mockPlusd = useMock(MOCK_KEYS.plusdAlias, parseAddress);
  const mockUsdc = useMock(MOCK_KEYS.usdcAlias, parseAddress);

  const DM_ADDRESS = ENV.DEPOSIT_MANAGER_ADDRESS;
  const isZeroAddress = DM_ADDRESS === ZERO_ADDRESS;

  // Generic per-address mock keys (read once per render; address strings are
  // stable primitives so this does not cause re-render loops).
  const mockPlUsdGeneric = readMock(
    MOCK_KEYS.contractPlUsd(DM_ADDRESS),
    parseAddress,
  );
  const mockUsdcGeneric = readMock(
    MOCK_KEYS.contractUsdc(DM_ADDRESS),
    parseAddress,
  );

  // Named aliases take precedence; fall back to generic per-address keys.
  const hasMockPlusd =
    mockPlusd !== undefined || mockPlUsdGeneric !== undefined;
  const hasMockUsdc = mockUsdc !== undefined || mockUsdcGeneric !== undefined;
  const hasMock = hasMockPlusd || hasMockUsdc;

  const shouldSkipReal = hasMock || isZeroAddress;

  const plUsdRead = useReadContract({
    address: DM_ADDRESS,
    abi: depositManagerAbi,
    functionName: "plUsd",
    query: { enabled: !shouldSkipReal, ...CACHE_FOREVER },
  });

  const usdcRead = useReadContract({
    address: DM_ADDRESS,
    abi: depositManagerAbi,
    functionName: "usdc",
    query: { enabled: !shouldSkipReal, ...CACHE_FOREVER },
  });

  // Named alias takes priority over generic key.
  if (mockPlusd !== undefined || mockUsdc !== undefined) {
    return {
      plusd: mockPlusd ?? mockPlUsdGeneric,
      usdc: mockUsdc ?? mockUsdcGeneric,
      isLoading: false,
      error: null,
    };
  }

  // Generic per-address key.
  if (hasMock) {
    return {
      plusd: mockPlUsdGeneric,
      usdc: mockUsdcGeneric,
      isLoading: false,
      error: null,
    };
  }

  // Zero-address short-circuit.
  if (isZeroAddress) {
    return {
      plusd: undefined,
      usdc: undefined,
      isLoading: false,
      error: null,
    };
  }

  // Real RPC path.
  const isLoading = plUsdRead.isLoading || usdcRead.isLoading;
  const error = (plUsdRead.error ?? usdcRead.error) as Error | null;

  return {
    plusd: plUsdRead.data as `0x${string}` | undefined,
    usdc: usdcRead.data as `0x${string}` | undefined,
    isLoading,
    error,
  };
}

// ── useDepositManagerMinDeposit ────────────────────────────────────────────────

/**
 * Reads the `minDeposit()` view function from the DepositManager contract.
 *
 * Priority order:
 *   1. Named-alias mock key (`pipeline.mock.wallet.contract.depositManager.minDeposit`).
 *   2. Generic per-address mock key (`pipeline.mock.wallet.contract.<addr>.minDeposit`).
 *   3. Zero-address short-circuit — returns `undefined` without making an RPC call.
 *   4. Real `useReadContract` call with "fetch once per page lifetime" caching.
 *
 * Note: `minDeposit` is not immutable (admin can call `setMinDeposit`), but
 * changes are rare; a stale value surfaces as a `DepositManagerLessThanMinAmount`
 * revert through the existing tx error path, which is acceptable.
 */
export function useDepositManagerMinDeposit(): DepositManagerMinDepositResult {
  // Named-alias mock key (reactive via useSyncExternalStore; bigint primitives
  // returned by parseBigInt are stable so getSnapshot will not loop).
  const mockAlias = useMock(MOCK_KEYS.minDepositAlias, parseBigInt);

  const DM_ADDRESS = ENV.DEPOSIT_MANAGER_ADDRESS;
  const isZeroAddress = DM_ADDRESS === ZERO_ADDRESS;

  // Generic per-address mock key (read once per render).
  const mockGeneric = readMock(
    MOCK_KEYS.contractMinDeposit(DM_ADDRESS),
    parseBigInt,
  );

  const hasMock = mockAlias !== undefined || mockGeneric !== undefined;
  const shouldSkipReal = hasMock || isZeroAddress;

  const minDepositRead = useReadContract({
    address: DM_ADDRESS,
    abi: depositManagerAbi,
    functionName: "minDeposit",
    query: { enabled: !shouldSkipReal, ...CACHE_FOREVER },
  });

  // Named alias takes priority over generic per-address key.
  if (mockAlias !== undefined) {
    return { minDeposit: mockAlias, isLoading: false, error: null };
  }

  // Generic per-address key.
  if (mockGeneric !== undefined) {
    return { minDeposit: mockGeneric, isLoading: false, error: null };
  }

  // Zero-address short-circuit.
  if (isZeroAddress) {
    return { minDeposit: undefined, isLoading: false, error: null };
  }

  // Real RPC path.
  return {
    minDeposit: minDepositRead.data as bigint | undefined,
    isLoading: minDepositRead.isLoading,
    error: minDepositRead.error as Error | null,
  };
}

// ── useRequestDeposit ─────────────────────────────────────────────────────────

/**
 * Write hook for `requestDeposit(uint256 amount) → uint256 requestId`.
 *
 * Mock key `pipeline.mock.wallet.contract.depositManager.requestDeposit`:
 *   JSON-encoded `{ hash: "0x...", requestId?: "123" }` — when set, `write()`
 *   returns immediately with that object and no RPC call is issued.
 *
 * Zero-address: `write()` sets `error` to `Error("DepositManager not configured")`
 *   without touching wagmi.
 *
 * Note: for write hooks we check the mock key inside the `write` callback
 * (via `readMock`) rather than tracking it reactively.  This avoids the
 * `useSyncExternalStore` "getSnapshot should be cached" warning that arises
 * when `parseJson` returns a new object on every render.
 */
export function useRequestDeposit(): RequestDepositResult {
  const DM_ADDRESS = ENV.DEPOSIT_MANAGER_ADDRESS;
  const isZeroAddress = DM_ADDRESS === ZERO_ADDRESS;

  // Detect whether the mock key is present (non-reactive check — the key is
  // typically set before mount in tests and before the user triggers a write).
  const hasMockKey =
    readMock(MOCK_KEYS.requestDeposit, parseJson) !== undefined;

  // Mock state for mock-key path.
  const [mockState, setMockState] = useState<{
    data: { hash: string; requestId?: string } | undefined;
    isPending: boolean;
    isSuccess: boolean;
    error: Error | null;
  }>({ data: undefined, isPending: false, isSuccess: false, error: null });

  // Zero-address error state.
  const [zeroAddrError, setZeroAddrError] = useState<Error | null>(null);

  // Wagmi write hook — always called (hooks must not be conditional).
  const wagmiWrite = useWriteContract();

  const resetMock = useCallback(() => {
    setMockState({
      data: undefined,
      isPending: false,
      isSuccess: false,
      error: null,
    });
    setZeroAddrError(null);
  }, []);

  const write = useCallback(
    (amount: bigint) => {
      // Re-read mock key at call time to pick up any dynamic changes.
      const mockRaw = readMock(
        MOCK_KEYS.requestDeposit,
        parseJson<{ hash: string; requestId?: string }>,
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

      if (isZeroAddress) {
        setZeroAddrError(new Error("DepositManager not configured"));
        return;
      }

      wagmiWrite.writeContract({
        abi: depositManagerAbi,
        address: DM_ADDRESS,
        functionName: "requestDeposit",
        args: [amount],
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isZeroAddress, DM_ADDRESS, wagmiWrite.writeContract],
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

  if (isZeroAddress) {
    return {
      write,
      data: undefined,
      isPending: false,
      isSuccess: false,
      error: zeroAddrError,
      reset: () => setZeroAddrError(null),
    };
  }

  // Real wagmi path.
  const txHash = wagmiWrite.data;
  return {
    write,
    data: txHash !== undefined ? { hash: txHash } : undefined,
    isPending: wagmiWrite.isPending,
    isSuccess: wagmiWrite.isSuccess,
    error: wagmiWrite.error as Error | null,
    reset: wagmiWrite.reset,
  };
}

// ── useClaim ──────────────────────────────────────────────────────────────────

/**
 * Write hook for `claim(uint256 requestId, bytes verifierSignature) → uint256 amount`.
 *
 * Mock key `pipeline.mock.wallet.contract.depositManager.claim`:
 *   JSON-encoded `{ hash: "0x...", amount?: "1000000" }` — when set, `write()`
 *   returns immediately with that object and no RPC call is issued.
 *
 * Zero-address: `write()` sets `error` to `Error("DepositManager not configured")`
 *   without touching wagmi.
 */
export function useClaim(): ClaimResult {
  const DM_ADDRESS = ENV.DEPOSIT_MANAGER_ADDRESS;
  const isZeroAddress = DM_ADDRESS === ZERO_ADDRESS;

  const hasMockKey = readMock(MOCK_KEYS.claim, parseJson) !== undefined;

  const [mockState, setMockState] = useState<{
    data: { hash: string; amount?: string } | undefined;
    isPending: boolean;
    isSuccess: boolean;
    error: Error | null;
  }>({ data: undefined, isPending: false, isSuccess: false, error: null });

  const [zeroAddrError, setZeroAddrError] = useState<Error | null>(null);

  const wagmiWrite = useWriteContract();

  const resetMock = useCallback(() => {
    setMockState({
      data: undefined,
      isPending: false,
      isSuccess: false,
      error: null,
    });
    setZeroAddrError(null);
  }, []);

  const write = useCallback(
    (requestId: bigint, verifierSignature: `0x${string}`) => {
      const mockRaw = readMock(
        MOCK_KEYS.claim,
        parseJson<{ hash: string; amount?: string }>,
      );

      if (mockRaw !== undefined) {
        setMockState({
          data: undefined,
          isPending: true,
          isSuccess: false,
          error: null,
        });
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

      if (isZeroAddress) {
        setZeroAddrError(new Error("DepositManager not configured"));
        return;
      }

      wagmiWrite.writeContract({
        abi: depositManagerAbi,
        address: DM_ADDRESS,
        functionName: "claim",
        args: [requestId, verifierSignature],
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isZeroAddress, DM_ADDRESS, wagmiWrite.writeContract],
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

  if (isZeroAddress) {
    return {
      write,
      data: undefined,
      isPending: false,
      isSuccess: false,
      error: zeroAddrError,
      reset: () => setZeroAddrError(null),
    };
  }

  const txHash = wagmiWrite.data;
  return {
    write,
    data: txHash !== undefined ? { hash: txHash } : undefined,
    isPending: wagmiWrite.isPending,
    isSuccess: wagmiWrite.isSuccess,
    error: wagmiWrite.error as Error | null,
    reset: wagmiWrite.reset,
  };
}
