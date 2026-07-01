/**
 * truncateAddress — shared wallet address truncation utility.
 *
 * Extracted from `useAccountDropdown.ts` per FRONTEND.md rule 3 (helper used
 * in 2+ places — lift to a shared util).
 *
 * EVM (0x…):    slices to `0xXXXX…XXXX` (6 + 4 chars).
 * Stellar (G…): slices to `GABCDE…WXYZ` (6 + 4 chars).
 * The 6+4 slice works uniformly for both formats.
 *
 * Input:  `0x8493...3b92` (42-char EVM) or a 56-char Stellar G… strkey.
 * Output: `0x8493…3b92` / `GABCDE…WXYZ`.
 *
 * Edge cases:
 *   - Empty string    → `""` (returned as-is).
 *   - Strings ≤ 12 chars → returned as-is (no truncation needed).
 */

/**
 * Truncates a wallet address for display.
 *
 * - Strings ≤ 12 characters are returned unchanged.
 * - Longer strings are sliced to `first6…last4`.
 */
export function truncateAddress(address: string): string {
  if (!address || address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
