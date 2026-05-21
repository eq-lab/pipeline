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
 *
 * Custom-error entries from the full ABI are included so viem can decode
 * reverts into named errors instead of "execution reverted". Required for
 * revert decoding via the `simulateOrFail` pre-flight (#350).
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

  // ── Custom errors (decoder hints) ──────────────────────────────────────────
  {
    type: "error",
    name: "AccessManagedInvalidAuthority",
    inputs: [{ name: "authority", type: "address" }],
  },
  {
    type: "error",
    name: "AccessManagedRequiredDelay",
    inputs: [
      { name: "caller", type: "address" },
      { name: "delay", type: "uint32" },
    ],
  },
  {
    type: "error",
    name: "AccessManagedUnauthorized",
    inputs: [{ name: "caller", type: "address" }],
  },
  {
    type: "error",
    name: "AddressEmptyCode",
    inputs: [{ name: "target", type: "address" }],
  },
  {
    type: "error",
    name: "ERC1967InvalidImplementation",
    inputs: [{ name: "implementation", type: "address" }],
  },
  { type: "error", name: "ERC1967NonPayable", inputs: [] },
  {
    type: "error",
    name: "ERC4626ExceededMaxDeposit",
    inputs: [
      { name: "receiver", type: "address" },
      { name: "assets", type: "uint256" },
      { name: "max", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "ERC4626ExceededMaxMint",
    inputs: [
      { name: "receiver", type: "address" },
      { name: "shares", type: "uint256" },
      { name: "max", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "ERC4626ExceededMaxRedeem",
    inputs: [
      { name: "owner", type: "address" },
      { name: "shares", type: "uint256" },
      { name: "max", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "ERC4626ExceededMaxWithdraw",
    inputs: [
      { name: "owner", type: "address" },
      { name: "assets", type: "uint256" },
      { name: "max", type: "uint256" },
    ],
  },
  { type: "error", name: "EnforcedPause", inputs: [] },
  { type: "error", name: "ExpectedPause", inputs: [] },
  { type: "error", name: "FailedCall", inputs: [] },
  { type: "error", name: "InvalidInitialization", inputs: [] },
  { type: "error", name: "NotInitializing", inputs: [] },
  {
    type: "error",
    name: "SafeERC20FailedOperation",
    inputs: [{ name: "token", type: "address" }],
  },
  { type: "error", name: "UUPSUnauthorizedCallContext", inputs: [] },
  {
    type: "error",
    name: "UUPSUnsupportedProxiableUUID",
    inputs: [{ name: "slot", type: "bytes32" }],
  },
] as const;
