/**
 * WithdrawalQueue wallet hooks.
 *
 * Provides `useWithdrawalQueueAddresses`, `useRequestWithdrawal`, and
 * `useClaimWithdrawal` — the on-chain interactions exposed by the
 * WithdrawalQueue contract.
 *
 * Mock-key precedence (same pattern as useDepositManager):
 *   1. Named-alias mock keys (`pipeline.mock.wallet.contract.withdrawalQueue.*`).
 *   2. Generic per-address mock keys (`pipeline.mock.wallet.contract.<addr>.*`).
 *   3. Zero-address short-circuit — hooks return `undefined` data without any
 *      RPC call when `VITE_WITHDRAWAL_QUEUE_ADDRESS` is the zero address.
 *   4. Real wagmi / viem calls.
 *
 * Important: the `requestId`, `queued`, and `amount` fields in `data` returned
 * by the write hooks are **mock-path only**. On the real wagmi path, `data`
 * contains only `{ hash }` because `useWriteContract` only resolves to a tx
 * hash — it does not decode the receipt return value. This mirrors the
 * behaviour of `useRequestDeposit` and `useClaim` in useDepositManager.ts.
 */
import { useState, useCallback, useEffect } from "react";
import {
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  usePublicClient,
} from "wagmi";
import { ENV } from "@/lib/env";
import { useMock, readMock, parseAddress, parseJson } from "./mock";
import { withdrawalQueueAbi } from "./abis/withdrawalQueue";
import { CACHE_FOREVER } from "./cache";
import { estimateGasCapped } from "./estimateGas";
import { simulateOrFail } from "./simulate";
import { useWallet } from "./useWallet";

// ── Mock-key constants ────────────────────────────────────────────────────────

const MOCK_KEYS = {
  /** Named alias — takes precedence over the generic per-address key. */
  plusdAlias: "pipeline.mock.wallet.contract.withdrawalQueue.plusd",
  usdcAlias: "pipeline.mock.wallet.contract.withdrawalQueue.usdc",
  requestWithdrawal:
    "pipeline.mock.wallet.contract.withdrawalQueue.requestWithdrawal",
  claimWithdrawal:
    "pipeline.mock.wallet.contract.withdrawalQueue.claimWithdrawal",
  /** Generic per-address key for `useContractRead` compatibility. */
  contractFromToken: (address: string) =>
    `pipeline.mock.wallet.contract.${address.toLowerCase()}.fromToken`,
  contractIntoToken: (address: string) =>
    `pipeline.mock.wallet.contract.${address.toLowerCase()}.intoToken`,
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WithdrawalQueueAddressesResult {
  plusd: `0x${string}` | undefined;
  usdc: `0x${string}` | undefined;
  isLoading: boolean;
  error: Error | null;
}

export interface RequestWithdrawalResult {
  write: (amount: bigint) => void;
  data: { hash: string; requestId?: string; queued?: string } | undefined;
  /**
   * `true` from broadcast until the receipt is mined (real path), or while the
   * mocked write is settling (mock path).
   */
  isPending: boolean;
  /**
   * Real path: `true` once the tx receipt is mined with status `success`.
   * Mock path: `true` after the mocked write settles in the next microtask.
   */
  isSuccess: boolean;
  error: Error | null;
  reset: () => void;
}

export interface ClaimWithdrawalResult {
  write: (requestId: bigint, verifierSignature: `0x${string}`) => void;
  data: { hash: string; amount?: string } | undefined;
  /**
   * `true` from broadcast until the receipt is mined (real path), or while the
   * mocked write is settling (mock path).
   */
  isPending: boolean;
  /**
   * Real path: `true` once the tx receipt is mined with status `success`.
   * Mock path: `true` after the mocked write settles in the next microtask.
   */
  isSuccess: boolean;
  error: Error | null;
  reset: () => void;
}

// ── useWithdrawalQueueAddresses ────────────────────────────────────────────────

/**
 * Reads the `fromToken()` (→ PLUSD) and `intoToken()` (→ USDC) view functions
 * from the WithdrawalQueue contract.
 *
 * The on-chain names are generic (`fromToken` / `intoToken`); this hook maps
 * them to domain-friendly aliases (`plusd` / `usdc`) matching what the deployed
 * WithdrawalQueue holds at those slots.
 *
 * Priority order:
 *   1. Named-alias mock keys (`pipeline.mock.wallet.contract.withdrawalQueue.plusd`
 *      / `…usdc`).
 *   2. Generic per-address mock keys (`pipeline.mock.wallet.contract.<addr>.fromToken`
 *      / `…intoToken`).
 *   3. Zero-address short-circuit — returns `undefined` data without making an
 *      RPC call.
 *   4. Real `useReadContract` calls with "fetch once per page lifetime" caching.
 */
export function useWithdrawalQueueAddresses(): WithdrawalQueueAddressesResult {
  // Named-alias mock keys (reactive via useSyncExternalStore; address strings
  // are primitives so getSnapshot always returns a stable value or undefined).
  const mockPlusd = useMock(MOCK_KEYS.plusdAlias, parseAddress);
  const mockUsdc = useMock(MOCK_KEYS.usdcAlias, parseAddress);

  const WQ_ADDRESS = ENV.WITHDRAWAL_QUEUE_ADDRESS;
  const isZeroAddress = WQ_ADDRESS === ZERO_ADDRESS;

  // Generic per-address mock keys (read once per render; address strings are
  // stable primitives so this does not cause re-render loops).
  const mockFromTokenGeneric = readMock(
    MOCK_KEYS.contractFromToken(WQ_ADDRESS),
    parseAddress,
  );
  const mockIntoTokenGeneric = readMock(
    MOCK_KEYS.contractIntoToken(WQ_ADDRESS),
    parseAddress,
  );

  // Named aliases take precedence; fall back to generic per-address keys.
  const hasMockPlusd =
    mockPlusd !== undefined || mockFromTokenGeneric !== undefined;
  const hasMockUsdc =
    mockUsdc !== undefined || mockIntoTokenGeneric !== undefined;
  const hasMock = hasMockPlusd || hasMockUsdc;

  const shouldSkipReal = hasMock || isZeroAddress;

  const fromTokenRead = useReadContract({
    address: WQ_ADDRESS,
    abi: withdrawalQueueAbi,
    functionName: "fromToken",
    query: { enabled: !shouldSkipReal, ...CACHE_FOREVER },
  });

  const intoTokenRead = useReadContract({
    address: WQ_ADDRESS,
    abi: withdrawalQueueAbi,
    functionName: "intoToken",
    query: { enabled: !shouldSkipReal, ...CACHE_FOREVER },
  });

  // Surface read errors to the console (real RPC path only).
  // Called unconditionally so it follows the Rules of Hooks; the inner
  // condition gates on whether a real error is present.
  useEffect(() => {
    if (fromTokenRead.error) {
      console.error(
        "[useWithdrawalQueueAddresses] fromToken() read failed:",
        fromTokenRead.error,
      );
    }
  }, [fromTokenRead.error]);

  useEffect(() => {
    if (intoTokenRead.error) {
      console.error(
        "[useWithdrawalQueueAddresses] intoToken() read failed:",
        intoTokenRead.error,
      );
    }
  }, [intoTokenRead.error]);

  // Named alias takes priority over generic key.
  if (mockPlusd !== undefined || mockUsdc !== undefined) {
    return {
      plusd: mockPlusd ?? mockFromTokenGeneric,
      usdc: mockUsdc ?? mockIntoTokenGeneric,
      isLoading: false,
      error: null,
    };
  }

  // Generic per-address key.
  if (hasMock) {
    return {
      plusd: mockFromTokenGeneric,
      usdc: mockIntoTokenGeneric,
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
  const isLoading = fromTokenRead.isLoading || intoTokenRead.isLoading;
  const error = (fromTokenRead.error ?? intoTokenRead.error) as Error | null;

  return {
    plusd: fromTokenRead.data as `0x${string}` | undefined,
    usdc: intoTokenRead.data as `0x${string}` | undefined,
    isLoading,
    error,
  };
}

// ── useRequestWithdrawal ──────────────────────────────────────────────────────

/**
 * Write hook for `requestWithdrawal(uint256 amount) → (uint256 requestId, uint256 queued)`.
 *
 * Mock key `pipeline.mock.wallet.contract.withdrawalQueue.requestWithdrawal`:
 *   JSON-encoded `{ hash: "0x...", requestId?: "123", queued?: "1000000" }` —
 *   when set, `write()` returns immediately with that object and no RPC call is
 *   issued.
 *
 * Zero-address: `write()` sets `error` to `Error("WithdrawalQueue not configured")`
 *   without touching wagmi.
 *
 * Note: `requestId` and `queued` are **mock-path only**. On the real wagmi path
 * `useWriteContract` only resolves to a tx hash — it does not decode the receipt
 * return tuple. This mirrors `useRequestDeposit`'s `requestId?` behaviour.
 *
 * Note: for write hooks we check the mock key inside the `write` callback
 * (via `readMock`) rather than tracking it reactively. This avoids the
 * `useSyncExternalStore` "getSnapshot should be cached" warning that arises
 * when `parseJson` returns a new object on every render.
 */
export function useRequestWithdrawal(): RequestWithdrawalResult {
  const WQ_ADDRESS = ENV.WITHDRAWAL_QUEUE_ADDRESS;
  const isZeroAddress = WQ_ADDRESS === ZERO_ADDRESS;

  // Detect whether the mock key is present (non-reactive check — the key is
  // typically set before mount in tests and before the user triggers a write).
  const hasMockKey =
    readMock(MOCK_KEYS.requestWithdrawal, parseJson) !== undefined;

  // Mock state for mock-key path.
  const [mockState, setMockState] = useState<{
    data: { hash: string; requestId?: string; queued?: string } | undefined;
    isPending: boolean;
    isSuccess: boolean;
    error: Error | null;
  }>({ data: undefined, isPending: false, isSuccess: false, error: null });

  // Write error state (zero-address, estimation failure, etc.).
  const [writeError, setWriteError] = useState<Error | null>(null);

  // Estimation in-flight flag — allows isPending to be true during estimation
  // and guards against re-entrant write calls.
  const [isEstimating, setIsEstimating] = useState(false);

  // Wagmi write hook — always called (hooks must not be conditional).
  const wagmiWrite = useWriteContract();

  // Connected wallet address for gas estimation and receipt gating.
  const { address, isConnected } = useWallet();

  // Derived — mirrors useApproval.ts pattern.
  const walletConnected = isConnected && address !== undefined;

  // Wagmi receipt hook — always called (hooks must not be conditional).
  // Gates `isSuccess` on the mined receipt instead of broadcast.
  const wagmiReceipt = useWaitForTransactionReceipt({
    hash: wagmiWrite.data,
    query: { enabled: walletConnected && wagmiWrite.data !== undefined },
  });

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
        MOCK_KEYS.requestWithdrawal,
        parseJson<{ hash: string; requestId?: string; queued?: string }>,
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
        setWriteError(new Error("WithdrawalQueue not configured"));
        return;
      }

      // Guard re-entrant calls while estimation is in flight.
      if (isEstimating) return;

      void (async () => {
        setIsEstimating(true);

        const simulated = await simulateOrFail({
          publicClient,
          account: address,
          abi: withdrawalQueueAbi,
          address: WQ_ADDRESS,
          functionName: "requestWithdrawal",
          args: [amount],
        });
        if (!simulated.ok) {
          setIsEstimating(false);
          setWriteError(simulated.error);
          return;
        }

        const result = await estimateGasCapped({
          publicClient,
          account: address,
          abi: withdrawalQueueAbi,
          address: WQ_ADDRESS,
          functionName: "requestWithdrawal",
          args: [amount],
        });
        setIsEstimating(false);

        if (!result.ok) {
          setWriteError(result.error);
          return;
        }

        wagmiWrite.writeContract({
          abi: withdrawalQueueAbi,
          address: WQ_ADDRESS,
          functionName: "requestWithdrawal",
          args: [amount],
          gas: result.gas,
        });
      })();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      isZeroAddress,
      isEstimating,
      WQ_ADDRESS,
      publicClient,
      address,
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

  if (isZeroAddress) {
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
  // `isSuccess` is gated on the mined receipt (not broadcast) — mirrors useApproval.
  const txHash = wagmiWrite.data;
  return {
    write,
    data: txHash !== undefined ? { hash: txHash } : undefined,
    isPending:
      isEstimating ||
      wagmiWrite.isPending ||
      (wagmiWrite.data !== undefined && wagmiReceipt.isLoading),
    isSuccess: wagmiReceipt.isSuccess,
    error: (writeError ??
      wagmiWrite.error ??
      wagmiReceipt.error) as Error | null,
    reset: () => {
      setWriteError(null);
      wagmiWrite.reset();
    },
  };
}

// ── useClaimWithdrawal ────────────────────────────────────────────────────────

/**
 * Write hook for `claimWithdrawal(uint256 requestId, bytes verifierSignature) → uint256 amount`.
 *
 * Mock key `pipeline.mock.wallet.contract.withdrawalQueue.claimWithdrawal`:
 *   JSON-encoded `{ hash: "0x...", amount?: "1000000" }` — when set, `write()`
 *   returns immediately with that object and no RPC call is issued.
 *
 * Zero-address: `write()` sets `error` to `Error("WithdrawalQueue not configured")`
 *   without touching wagmi.
 *
 * The `verifierSignature` is an EIP-712 voucher bytes string obtained from
 * `GET /v1/withdrawals/{request_id}/voucher` — fetching it is out of scope for
 * this hook; the caller is responsible for supplying it.
 */
export function useClaimWithdrawal(): ClaimWithdrawalResult {
  const WQ_ADDRESS = ENV.WITHDRAWAL_QUEUE_ADDRESS;
  const isZeroAddress = WQ_ADDRESS === ZERO_ADDRESS;

  const hasMockKey =
    readMock(MOCK_KEYS.claimWithdrawal, parseJson) !== undefined;

  const [mockState, setMockState] = useState<{
    data: { hash: string; amount?: string } | undefined;
    isPending: boolean;
    isSuccess: boolean;
    error: Error | null;
  }>({ data: undefined, isPending: false, isSuccess: false, error: null });

  // Write error state (zero-address, estimation failure, etc.).
  const [writeError, setWriteError] = useState<Error | null>(null);

  // Estimation in-flight flag — allows isPending to be true during estimation
  // and guards against re-entrant write calls.
  const [isEstimating, setIsEstimating] = useState(false);

  const wagmiWrite = useWriteContract();

  // Connected wallet address for gas estimation and receipt gating.
  const { address, isConnected } = useWallet();

  // Derived — mirrors useApproval.ts pattern.
  const walletConnected = isConnected && address !== undefined;

  // Wagmi receipt hook — always called (hooks must not be conditional).
  // Gates `isSuccess` on the mined receipt instead of broadcast.
  const wagmiReceipt = useWaitForTransactionReceipt({
    hash: wagmiWrite.data,
    query: { enabled: walletConnected && wagmiWrite.data !== undefined },
  });

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
    (requestId: bigint, verifierSignature: `0x${string}`) => {
      const mockRaw = readMock(
        MOCK_KEYS.claimWithdrawal,
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
        setWriteError(new Error("WithdrawalQueue not configured"));
        return;
      }

      // Guard re-entrant calls while estimation is in flight.
      if (isEstimating) return;

      void (async () => {
        setIsEstimating(true);

        const simulated = await simulateOrFail({
          publicClient,
          account: address,
          abi: withdrawalQueueAbi,
          address: WQ_ADDRESS,
          functionName: "claimWithdrawal",
          args: [requestId, verifierSignature],
        });
        if (!simulated.ok) {
          setIsEstimating(false);
          setWriteError(simulated.error);
          return;
        }

        const result = await estimateGasCapped({
          publicClient,
          account: address,
          abi: withdrawalQueueAbi,
          address: WQ_ADDRESS,
          functionName: "claimWithdrawal",
          args: [requestId, verifierSignature],
        });
        setIsEstimating(false);

        if (!result.ok) {
          setWriteError(result.error);
          return;
        }

        wagmiWrite.writeContract({
          abi: withdrawalQueueAbi,
          address: WQ_ADDRESS,
          functionName: "claimWithdrawal",
          args: [requestId, verifierSignature],
          gas: result.gas,
        });
      })();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      isZeroAddress,
      isEstimating,
      WQ_ADDRESS,
      publicClient,
      address,
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

  if (isZeroAddress) {
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
  // `isSuccess` is gated on the mined receipt (not broadcast) — mirrors useApproval.
  const txHash = wagmiWrite.data;
  return {
    write,
    data: txHash !== undefined ? { hash: txHash } : undefined,
    isPending:
      isEstimating ||
      wagmiWrite.isPending ||
      (wagmiWrite.data !== undefined && wagmiReceipt.isLoading),
    isSuccess: wagmiReceipt.isSuccess,
    error: (writeError ??
      wagmiWrite.error ??
      wagmiReceipt.error) as Error | null,
    reset: () => {
      setWriteError(null);
      wagmiWrite.reset();
    },
  };
}
