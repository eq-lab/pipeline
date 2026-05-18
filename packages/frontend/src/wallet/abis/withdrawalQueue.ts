/**
 * Minimal WithdrawalQueue ABI subset used by the LP UI wallet hooks.
 *
 * Only the four functions consumed by the LP UI are listed here — the full
 * ABI lives in `docs.local/withdrawal_abi.txt`. Typed `as const` so viem picks
 * up exact return types for each function.
 *
 * The on-chain function names (`fromToken` / `intoToken`) are generic; the
 * deployed WithdrawalQueue holds PLUSD / USDC at those slots respectively.
 * The wallet hooks expose them under domain-friendly aliases (`plusd` / `usdc`)
 * while this ABI retains the canonical on-chain names.
 */
export const withdrawalQueueAbi = [
  {
    type: "function",
    name: "fromToken",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "intoToken",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "requestWithdrawal",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [
      { name: "requestId", type: "uint256" },
      { name: "queued", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "claimWithdrawal",
    stateMutability: "nonpayable",
    inputs: [
      { name: "requestId", type: "uint256" },
      { name: "verifierSignature", type: "bytes" },
    ],
    outputs: [{ name: "amount", type: "uint256" }],
  },
] as const;
