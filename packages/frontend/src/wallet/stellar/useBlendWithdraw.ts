/**
 * `useBlendWithdraw` — write hook for withdrawing collateral from the Blend pool.
 *
 * Returns `{ write(amount, reserveId?), data, isPending, isSuccess, error, reset }`.
 *
 * Mock layer: when `pipeline.mock.wallet.stellar.blend.withdraw` is set in
 * localStorage, `write()` resolves with the mocked `{ hash }` without
 * touching the Soroban RPC or the wallet signing flow.
 *
 * Real path: builds the `WithdrawCollateral` submit op, runs the full Soroban
 * lifecycle (simulate → assemble → sign → send → poll), and exposes the
 * result.
 *
 * Thin wrapper around the shared `useBlendSubmit` body.
 */
import { RequestType } from "./blendPool";
import { useBlendSubmit, type BlendWriteResult } from "./-useBlendSubmit";
import { blendXlmId } from "./chain";

export type { BlendWriteResult };

/**
 * Write hook for `WithdrawCollateral` (withdraw) operations on the Blend pool.
 *
 * @param defaultReserveId - Reserve asset address to default to when `write()`
 *   is called without an explicit `reserveId`. Defaults to the XLM reserve
 *   (`blendXlmId`), the acceptance-test asset.
 */
export function useBlendWithdraw(defaultReserveId?: string): BlendWriteResult {
  return useBlendSubmit(
    RequestType.WithdrawCollateral,
    defaultReserveId ?? blendXlmId,
    "withdraw",
  );
}
