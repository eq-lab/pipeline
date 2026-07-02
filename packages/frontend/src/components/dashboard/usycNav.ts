/**
 * USYC NAV conversion seam — Balance Sheet panel (Panel A).
 *
 * v1 identity stub: returns `usycAmount` unchanged (1:1 USYC → USDC).
 * When real NAV data is available, replace this function body with a call to
 * the issuer's NAV endpoint or the USYC `convert_to_assets`-style view.
 *
 * This module is intentionally tiny and self-contained so the swap is a
 * single-file edit. The `useBalanceSheetPanel` hook calls this; with no USYC
 * holding configured, the input is `0n` / `undefined` and the row renders `—`.
 *
 * Usage:
 * ```ts
 * const usycInUsdc = convertUsycToUsdc(usycAmount);
 * ```
 */

/**
 * Converts a USYC amount to its USDC equivalent.
 *
 * @param usycAmount - Raw USYC amount at 7-decimal SAC scale.
 * @returns The equivalent USDC amount at the same 7-decimal scale.
 *
 * Current implementation: 1:1 identity stub. Replace with real NAV when
 * the USYC oracle / issuer NAV endpoint is available.
 */
export function convertUsycToUsdc(usycAmount: bigint): bigint {
  return usycAmount;
}
