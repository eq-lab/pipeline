/**
 * ERC-20 allowance check / approve hook.
 *
 * Provides `useApproval({ token, spender })` — a generic, reusable hook that
 * reads `allowance(owner, spender)` and exposes `approve(spender, amount)` for
 * any (token, spender) pair.
 *
 * Mock layer:
 *   - `pipeline.mock.wallet.allowance.<token>.<spender>` — decimal bigint
 *     string; bypasses the real allowance read.
 *   - `pipeline.mock.wallet.contract.<token>.approve` — JSON `{ hash: "0x…" }`;
 *     bypasses the real approve transaction.
 *
 * See `packages/frontend/src/wallet/README.md` for mock key details and
 * DevTools console snippets.
 */
import { useEffect, useState, useCallback } from "react";
import {
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  usePublicClient,
} from "wagmi";
import { useMock, readMock, parseBigInt, parseJson } from "./mock";
import { useWallet } from "./useWallet";
import { erc20Abi } from "./abis/erc20";
import { estimateGasCapped } from "./estimateGas";

// ── Mock-key constants ────────────────────────────────────────────────────────

const MOCK_KEYS = {
  allowance: (token: string, spender: string) =>
    `pipeline.mock.wallet.allowance.${token.toLowerCase()}.${spender.toLowerCase()}`,
  approve: (token: string) =>
    `pipeline.mock.wallet.contract.${token.toLowerCase()}.approve`,
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UseApprovalArgs {
  token: `0x${string}`;
  spender: `0x${string}`;
}

export interface UseApprovalResult {
  /**
   * Current ERC-20 allowance for (owner=connected wallet, spender).
   *
   * `undefined` when:
   *   - wallet is disconnected
   *   - token or spender is the zero address
   *   - the read is still in flight
   */
  allowance: bigint | undefined;
  /**
   * Returns `true` when `allowance >= amount`.
   * Returns `false` when `allowance` is `undefined` (pessimistic: "we don't
   * know, assume insufficient"). Stable identity across renders for a given
   * `allowance` value.
   */
  isSufficient: (amount: bigint) => boolean;
  /**
   * Triggers `approve(spender, amount)` on the token contract.
   * No-op (sets `error`) when token or spender is the zero address or the
   * wallet is disconnected.
   */
  approve: (amount: bigint) => void;
  /** Populated after the approve tx is broadcast. */
  data: { hash: string } | undefined;
  /** `true` while the allowance read is in flight. */
  isLoading: boolean;
  /**
   * `true` from broadcast until the receipt is mined (real path), or while the
   * mocked approve is settling (mock path).
   */
  isPending: boolean;
  /**
   * Real path: `true` once the approve tx receipt is mined and status is
   * `success`. Mock path: `true` after the mocked approve settles in the next
   * microtask. (This differs from `useRequestDeposit` / `useClaim`, which fire
   * on broadcast.)
   */
  isSuccess: boolean;
  /** Read or write error; cleared by `reset()`. */
  error: Error | null;
  /** Clears `data`, `error`, and resets `isPending`/`isSuccess`. */
  reset: () => void;
  /**
   * Re-reads the current allowance. Wired to wagmi's `useReadContract`
   * `refetch`. Called automatically after a successful approve so callers
   * see the updated allowance without doing anything.
   *
   * Note: external allowance changes (e.g. user approves from another dapp)
   * are NOT auto-detected; call `refetch()` manually or wire a polling
   * mechanism if needed.
   */
  refetch: () => void;
}

// ── Mock state shape ──────────────────────────────────────────────────────────

interface ApproveMockState {
  data: { hash: string } | undefined;
  isPending: boolean;
  isSuccess: boolean;
  error: Error | null;
}

const INITIAL_MOCK_STATE: ApproveMockState = {
  data: undefined,
  isPending: false,
  isSuccess: false,
  error: null,
};

// ── useApproval ───────────────────────────────────────────────────────────────

/**
 * Reads `allowance(owner, spender)` and exposes `approve(spender, amount)` for
 * any (token, spender) ERC-20 pair.
 *
 * The hook consults the mock layer first; when mock keys are present no RPC
 * call is issued. See `README.md` for key schema.
 */
export function useApproval({
  token,
  spender,
}: UseApprovalArgs): UseApprovalResult {
  const { address, isConnected } = useWallet();

  const tokenIsZero = token === ZERO_ADDRESS;
  const spenderIsZero = spender === ZERO_ADDRESS;
  const walletConnected = isConnected && address !== undefined;

  // ── Mock allowance (reactive) ───────────────────────────────────────────────
  // useMock returns a bigint primitive which is stable across renders.
  const mockAllowance = useMock(
    MOCK_KEYS.allowance(token, spender),
    parseBigInt,
  );
  const mockAllowanceSet = mockAllowance !== undefined;

  // ── Real allowance read ─────────────────────────────────────────────────────
  // NOTE: Do NOT use CACHE_FOREVER here — allowances change after approve calls.
  // TanStack Query defaults apply; the auto-refetch-on-success handles the
  // immediate post-approve case.
  const allowanceRead = useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [address ?? ZERO_ADDRESS, spender],
    query: {
      enabled:
        !mockAllowanceSet && walletConnected && !tokenIsZero && !spenderIsZero,
    },
  });

  // ── Approve mock state ──────────────────────────────────────────────────────
  // Non-reactive check — avoids getSnapshot churn with JSON-returning parsers.
  const hasApproveMock =
    readMock(MOCK_KEYS.approve(token), parseJson) !== undefined;

  const [mockState, setMockState] =
    useState<ApproveMockState>(INITIAL_MOCK_STATE);

  // ── Write error state (zero-address / disconnected / estimation) ────────────
  const [writeError, setWriteError] = useState<Error | null>(null);

  // Estimation in-flight flag — allows isPending to be true during estimation
  // and guards against re-entrant approve calls.
  const [isEstimating, setIsEstimating] = useState(false);

  // ── Wagmi write hook — always called (hooks must not be conditional) ─────────
  const wagmiWrite = useWriteContract();

  // ── Wagmi receipt hook — always called (hooks must not be conditional) ───────
  // Tracks the mined receipt for the in-flight approve tx hash. Gated on
  // walletConnected && hash defined to avoid stale watches on disconnect.
  const wagmiReceipt = useWaitForTransactionReceipt({
    hash: wagmiWrite.data,
    query: { enabled: walletConnected && wagmiWrite.data !== undefined },
  });

  // ── Public client for gas estimation — always called ─────────────────────────
  const publicClient = usePublicClient();

  // ── Derived values ──────────────────────────────────────────────────────────

  const allowance: bigint | undefined = mockAllowanceSet
    ? mockAllowance
    : walletConnected && !tokenIsZero && !spenderIsZero
      ? (allowanceRead.data as bigint | undefined)
      : undefined;

  // Real path: pending from broadcast until receipt is mined.
  const realIsPending =
    wagmiWrite.isPending ||
    (wagmiWrite.data !== undefined && wagmiReceipt.isLoading);
  // Real path: success only after receipt confirms with status "success".
  const realIsSuccess = wagmiReceipt.isSuccess;

  const isSuccess = hasApproveMock ? mockState.isSuccess : realIsSuccess;

  // ── Auto-refetch after successful approve ────────────────────────────────────
  // Covers both mock path (mockState.isSuccess) and real path (wagmiReceipt.isSuccess).
  // The refetch now reads the post-mine allowance, eliminating the stale-cache
  // window that existed when we fired on broadcast (wagmiWrite.isSuccess).
  const refetch = allowanceRead.refetch as () => void;

  useEffect(() => {
    if (isSuccess) {
      refetch();
    }
  }, [isSuccess, refetch]);

  // ── approve callback ─────────────────────────────────────────────────────────

  const approve = useCallback(
    (amount: bigint) => {
      // Re-read mock key at call time to pick up any dynamic changes.
      const approveMock = readMock(
        MOCK_KEYS.approve(token),
        parseJson<{ hash: string }>,
      );

      if (approveMock !== undefined) {
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
            data: approveMock,
            isPending: false,
            isSuccess: true,
            error: null,
          });
        });
        return;
      }

      if (!walletConnected) {
        setWriteError(new Error("Wallet not connected"));
        return;
      }

      if (tokenIsZero) {
        setWriteError(new Error("Token not configured"));
        return;
      }

      if (spenderIsZero) {
        setWriteError(new Error("Spender not configured"));
        return;
      }

      // Guard re-entrant calls while estimation is in flight.
      if (isEstimating) return;

      void (async () => {
        setIsEstimating(true);
        const result = await estimateGasCapped({
          publicClient,
          account: address,
          abi: erc20Abi,
          address: token,
          functionName: "approve",
          args: [spender, amount],
        });
        setIsEstimating(false);

        if (!result.ok) {
          setWriteError(result.error);
          return;
        }

        wagmiWrite.writeContract({
          abi: erc20Abi,
          address: token,
          functionName: "approve",
          args: [spender, amount],
          gas: result.gas,
        });
      })();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      token,
      spender,
      walletConnected,
      tokenIsZero,
      spenderIsZero,
      isEstimating,
      publicClient,
      address,
      wagmiWrite.writeContract,
    ],
  );

  // ── isSufficient ─────────────────────────────────────────────────────────────

  const isSufficient = useCallback(
    (amount: bigint): boolean => {
      if (allowance === undefined) return false;
      return allowance >= amount;
    },
    [allowance],
  );

  // ── reset ────────────────────────────────────────────────────────────────────

  const reset = useCallback(() => {
    setMockState(INITIAL_MOCK_STATE);
    setWriteError(null);
    wagmiWrite.reset();
  }, [wagmiWrite.reset]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Return value — branch on mock path ──────────────────────────────────────

  if (hasApproveMock) {
    return {
      allowance,
      isSufficient,
      approve,
      data: mockState.data,
      isLoading: mockAllowanceSet ? false : allowanceRead.isLoading,
      isPending: mockState.isPending,
      isSuccess: mockState.isSuccess,
      error: mockState.error,
      reset,
      refetch,
    };
  }

  // Zero-address / disconnected guard.
  if (!walletConnected || tokenIsZero || spenderIsZero) {
    return {
      allowance,
      isSufficient,
      approve,
      data: undefined,
      isLoading: false,
      isPending: false,
      isSuccess: false,
      error: writeError,
      reset,
      refetch,
    };
  }

  // Real wagmi path.
  const txHash = wagmiWrite.data;
  return {
    allowance,
    isSufficient,
    approve,
    data: txHash !== undefined ? { hash: txHash } : undefined,
    isLoading: mockAllowanceSet ? false : allowanceRead.isLoading,
    isPending: isEstimating || realIsPending,
    isSuccess: realIsSuccess,
    error: (writeError ??
      wagmiWrite.error ??
      wagmiReceipt.error ??
      allowanceRead.error) as Error | null,
    reset,
    refetch,
  };
}
