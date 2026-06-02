/**
 * Minimal DepositManager ABI subset used by the LP UI wallet hooks.
 *
 * Only the functions consumed by the LP UI are listed here — the full ABI
 * lives in `docs.local/manager_abi.txt`. Custom-error entries from the full
 * ABI are included so viem can decode reverts into named errors (e.g.
 * `VerifiedRequestsInvalidSignature()`) instead of "execution reverted".
 *
 * Typed `as const` so viem picks up exact return types for each function.
 */
export const depositManagerAbi = [
  {
    type: "function",
    name: "plUsd",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "usdc",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "minDeposit",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "requestDeposit",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [{ name: "requestId", type: "uint256" }],
  },
  {
    type: "function",
    name: "claimDeposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "requestId", type: "uint256" },
      { name: "verifierSignature", type: "bytes" },
    ],
    outputs: [{ name: "amount", type: "uint256" }],
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
  { type: "error", name: "DepositManagerLessThanMinAmount", inputs: [] },
  { type: "error", name: "DepositManagerSameValue", inputs: [] },
  { type: "error", name: "DepositManagerZeroAddress", inputs: [] },
  { type: "error", name: "ECDSAInvalidSignature", inputs: [] },
  {
    type: "error",
    name: "ECDSAInvalidSignatureLength",
    inputs: [{ name: "length", type: "uint256" }],
  },
  {
    type: "error",
    name: "ECDSAInvalidSignatureS",
    inputs: [{ name: "s", type: "bytes32" }],
  },
  {
    type: "error",
    name: "ERC1967InvalidImplementation",
    inputs: [{ name: "implementation", type: "address" }],
  },
  { type: "error", name: "ERC1967NonPayable", inputs: [] },
  { type: "error", name: "EnforcedPause", inputs: [] },
  { type: "error", name: "ExpectedPause", inputs: [] },
  { type: "error", name: "FailedCall", inputs: [] },
  { type: "error", name: "InvalidInitialization", inputs: [] },
  { type: "error", name: "NotInitializing", inputs: [] },
  { type: "error", name: "RateLimiterExceedsTxLimit", inputs: [] },
  { type: "error", name: "RateLimiterExceedsWindowLimit", inputs: [] },
  { type: "error", name: "RateLimiterWrongValue", inputs: [] },
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
  { type: "error", name: "VerifiedRequestsInvalidRequestId", inputs: [] },
  { type: "error", name: "VerifiedRequestsInvalidSender", inputs: [] },
  { type: "error", name: "VerifiedRequestsInvalidSignature", inputs: [] },
  { type: "error", name: "VerifiedRequestsQueueAlreadyClaimed", inputs: [] },
  { type: "error", name: "VerifiedRequestsQueueZeroAmount", inputs: [] },
  { type: "error", name: "VerifiedRequestsSameValue", inputs: [] },
  { type: "error", name: "VerifiedRequestsZeroAddress", inputs: [] },
] as const;
