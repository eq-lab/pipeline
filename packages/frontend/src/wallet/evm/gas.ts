/**
 * Gas estimation utilities for wallet write hooks.
 *
 * The target chain (Hoodi) enforces a per-tx gas cap of 0x1000000 (16,777,216).
 * viem's fallback when gas estimation fails is 21,000,000 — which exceeds the
 * cap and causes the RPC to reject the tx before broadcast.
 *
 * All write hooks must:
 *   1. Pre-estimate gas via `estimateContractGas`.
 *   2. Apply a +20 % buffer (`gas * 12n / 10n`).
 *   3. Clamp the result below `EVM_TX_GAS_CAP`.
 *   4. Pass the clamped value as `gas` to `writeContract`.
 *
 * When estimation fails, surface the error on the hook's `error` field and
 * skip the `writeContract` call entirely.
 *
 * See: https://github.com/eq-lab/pipeline/issues/342
 */

/**
 * Per-tx gas cap on the target chain (Hoodi): 0x1000000 - 1.
 * Hard-coded — the cap is a chain constant, not an env parameter.
 * Encoded as `cap - 1` so a buffered estimate landing exactly on the cap
 * still passes without needing a strictly-less-than comparison.
 */
export const EVM_TX_GAS_CAP = 16_777_215n;

/** Numerator for the +20 % gas buffer: `gas * 12 / 10`. */
export const GAS_BUFFER_NUMERATOR = 12n;
/** Denominator for the +20 % gas buffer. */
export const GAS_BUFFER_DENOMINATOR = 10n;

/**
 * Applies the +20 % gas buffer to a raw estimate.
 * `gas * 12n / 10n` (integer division — always rounds down; safe for gas).
 */
export function applyGasBuffer(gas: bigint): bigint {
  return (gas * GAS_BUFFER_NUMERATOR) / GAS_BUFFER_DENOMINATOR;
}

/**
 * Clamps a gas value to at most `EVM_TX_GAS_CAP`.
 * Buffer must be applied **before** clamping so the ceiling is respected.
 */
export function clampGas(gas: bigint): bigint {
  return gas > EVM_TX_GAS_CAP ? EVM_TX_GAS_CAP : gas;
}
