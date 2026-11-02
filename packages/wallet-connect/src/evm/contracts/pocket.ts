// spec: docs/product-specs/staking.md#default-pockets
export const pocketAbi = [
  {
    type: "function",
    name: "pocket",
    stateMutability: "view",
    inputs: [{ name: "loanId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [{ name: "balance", type: "uint256" }],
      },
    ],
  },
  {
    type: "function",
    name: "claimable",
    stateMutability: "view",
    inputs: [
      { name: "holder", type: "address" },
      { name: "loanId", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "claimed",
    stateMutability: "view",
    inputs: [
      { name: "holder", type: "address" },
      { name: "loanId", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [
      { name: "holder", type: "address" },
      { name: "loanId", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
