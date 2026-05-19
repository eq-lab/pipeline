/**
 * Minimal StakedPLUSD (sPLUSD) ERC-4626 vault ABI subset used by the LP UI wallet hooks.
 *
 * Only the five functions consumed by the LP UI are listed here — the full
 * ABI lives in `docs.local/splusd_abi.txt`. Typed `as const` so viem picks
 * up exact return types for each function.
 *
 * The ERC-20 surface of the sPLUSD share token (`decimals`, `symbol`,
 * `balanceOf`, `allowance`, `approve`, etc.) is intentionally excluded — those
 * are covered by the existing `erc20Abi` via `useToken` / `useApproval`.
 * UUPS / AccessManaged plumbing entries are also excluded.
 */
export const stakedPlusdAbi = [
  {
    type: "function",
    name: "asset",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "convertToShares",
    stateMutability: "view",
    inputs: [{ name: "assets", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "convertToAssets",
    stateMutability: "view",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assets", type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "redeem",
    stateMutability: "nonpayable",
    inputs: [
      { name: "shares", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "owner", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
