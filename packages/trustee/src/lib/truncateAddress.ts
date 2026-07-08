/**
 * Truncates a wallet address for display: `0x1234…abcd` / `GABCD…WXYZ`.
 *
 * Relocated from `TrusteeShell.tsx` (#777 scaffold) when the shell was
 * reworked into the sidebar app shell (#786) — the account chip in
 * `TrusteeSidebar` needs the same helper.
 */
export function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
