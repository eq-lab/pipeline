/**
 * Minimal DepositManager ABI subset used by the LP UI wallet hooks.
 *
 * Only the four functions consumed by the LP UI are listed here — the full
 * ABI lives in `docs.local/manager_abi.txt`. Typed `as const` so viem picks
 * up exact return types for each function.
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
    name: "requestDeposit",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [{ name: "requestId", type: "uint256" }],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [
      { name: "requestId", type: "uint256" },
      { name: "verifierSignature", type: "bytes" },
    ],
    outputs: [{ name: "amount", type: "uint256" }],
  },
] as const;
