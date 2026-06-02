/**
 * Shared body for `useBlendDeposit` and `useBlendWithdraw`.
 *
 * Private module (prefixed with `-`) — not exported from the barrel.
 * Import only from `useBlendDeposit.ts` and `useBlendWithdraw.ts`.
 *
 * Mirrors the pattern in `evm/useDepositManager.ts`:
 *   - Mock key read inside `write()` callback (non-reactive) to avoid the
 *     `useSyncExternalStore` "getSnapshot should be cached" warning.
 *   - `isPending` spans estimation → signing → polling.
 *   - `isSuccess` is set on terminal SUCCESS status.
 *   - `error` is surfaced as `Error | null`.
 *   - `reset` clears all state.
 */
import { useState, useCallback } from "react";
import { buildSubmitOpXdr, submitBlendTx, type RequestType } from "./blendPool";
import { readMockBlendDeposit, readMockBlendWithdraw } from "./mock";
import { useStellarWallet } from "./useStellarWallet";
import { blendPoolId } from "./chain";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BlendWriteResult {
  /**
   * Trigger the deposit or withdraw.
   *
   * @param amount - raw 7-decimal fixed-point bigint (1 XLM = 10_000_000n).
   * @param reserveId - optional override for the reserve asset address.
   *   When omitted, uses the `defaultReserveId` passed to `useBlendSubmit`.
   */
  write: (amount: bigint, reserveId?: string) => void;
  /** `{ hash }` on success, `undefined` while pending or before first call. */
  data: { hash: string } | undefined;
  /**
   * `true` from the moment `write()` is called until the transaction
   * reaches a terminal state (SUCCESS or error).
   */
  isPending: boolean;
  /** `true` once the Soroban transaction reaches SUCCESS status. */
  isSuccess: boolean;
  /** Error from simulation, signing, sending, or polling; `null` otherwise. */
  error: Error | null;
  /** Resets all state (data / isPending / isSuccess / error) to initial. */
  reset: () => void;
}

// ── useBlendSubmit ─────────────────────────────────────────────────────────────

/**
 * Shared write-hook body for deposit and withdraw operations on the Blend pool.
 *
 * @param requestType - `RequestType.SupplyCollateral` or `RequestType.WithdrawCollateral`.
 * @param defaultReserveId - reserve asset address when the caller's `write()` omits one.
 * @param mockFlavor - `"deposit"` or `"withdraw"`, selects which mock key to read.
 */
export function useBlendSubmit(
  requestType: RequestType,
  defaultReserveId: string,
  mockFlavor: "deposit" | "withdraw",
): BlendWriteResult {
  // State mirrors the EVM write-hook pattern.
  const [data, setData] = useState<{ hash: string } | undefined>(undefined);
  const [isPending, setIsPending] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  // In-flight guard — prevents re-entrant calls while a transaction is pending.
  const [isInFlight, setIsInFlight] = useState(false);

  const { address, isConnected, signTransaction } = useStellarWallet();

  const reset = useCallback(() => {
    setData(undefined);
    setIsPending(false);
    setIsSuccess(false);
    setError(null);
  }, []);

  const write = useCallback(
    (amount: bigint, reserveId?: string) => {
      const effectiveReserveId = reserveId ?? defaultReserveId;

      // ── Mock fast-path ────────────────────────────────────────────────────
      // Re-read at call time (non-reactive) to pick up any dynamic changes
      // and avoid the `getSnapshot` warning — same pattern as the EVM hooks.
      const mockResult =
        mockFlavor === "deposit"
          ? readMockBlendDeposit()
          : readMockBlendWithdraw();

      if (mockResult !== undefined) {
        setData(undefined);
        setIsPending(true);
        setIsSuccess(false);
        setError(null);
        // Settle in the next microtask so `isPending: true` is observable.
        Promise.resolve().then(() => {
          setData(mockResult);
          setIsPending(false);
          setIsSuccess(true);
        });
        return;
      }

      // ── Disconnected guard ────────────────────────────────────────────────
      if (!isConnected || !address) {
        setError(new Error("Stellar wallet not connected"));
        return;
      }

      // ── Re-entrant guard ──────────────────────────────────────────────────
      if (isInFlight) return;

      // ── Real Soroban path ─────────────────────────────────────────────────
      setIsInFlight(true);
      setIsPending(true);
      setData(undefined);
      setIsSuccess(false);
      setError(null);

      void (async () => {
        try {
          const opXdr = buildSubmitOpXdr({
            poolId: blendPoolId,
            from: address,
            reserveId: effectiveReserveId,
            amount,
            requestType,
          });

          const result = await submitBlendTx({
            opXdr,
            sourceAddress: address,
            sign: signTransaction,
          });

          setData(result);
          setIsSuccess(true);
        } catch (err) {
          setError(err instanceof Error ? err : new Error(String(err)));
        } finally {
          setIsPending(false);
          setIsInFlight(false);
        }
      })();
    },
    [
      address,
      isConnected,
      isInFlight,
      requestType,
      defaultReserveId,
      mockFlavor,
      signTransaction,
    ],
  );

  return { write, data, isPending, isSuccess, error, reset };
}
