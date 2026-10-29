// spec: docs/product-specs/loan-repayment-recovery.md
import { encodeFunctionData, type Hex } from "viem";
import type { RepaymentInput } from "../../stellar/contracts/loanRegistry";

export const minterRecoveryAbi = [
  {
    type: "function",
    name: "reverseRepay",
    stateMutability: "nonpayable",
    inputs: [
      { name: "loanId", type: "uint256" },
      { name: "repaymentId", type: "uint256" },
      { name: "refHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "repay",
    stateMutability: "nonpayable",
    inputs: [
      { name: "loanId", type: "uint256" },
      {
        name: "repaymentData",
        type: "tuple",
        components: [
          { name: "offtakerReceived", type: "uint256" },
          { name: "seniorPrincipalRepaid", type: "uint256" },
          { name: "seniorInterest", type: "uint256" },
          { name: "equityDistributed", type: "uint256" },
          { name: "mgmtFee", type: "uint256" },
          { name: "perfFee", type: "uint256" },
          { name: "oetAlloc", type: "uint256" },
        ],
      },
      { name: "valueDate", type: "uint64" },
      { name: "refHash", type: "bytes32" },
      { name: "saleId", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export interface EvmReverseRepayArgs {
  loanId: number | bigint;
  repaymentId: number | bigint;
  refHash: string;
}

export interface EvmRepayArgs {
  loanId: number | bigint;
  repayment: RepaymentInput;
  valueDate: number | bigint;
  refHash: string;
  saleId?: number | bigint;
}

const ZERO_HASH = `0x${"0".repeat(64)}`;

function checkRefHash(who: string, refHash: string): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(refHash)) {
    throw new Error(`${who}: refHash must be 0x followed by 64 hex characters`);
  }
  if (refHash === ZERO_HASH) {
    throw new Error(`${who}: refHash must not be the zero hash`);
  }
  return refHash as Hex;
}

export function encodeEvmReverseRepayCalldata({
  loanId,
  repaymentId,
  refHash,
}: EvmReverseRepayArgs): Hex {
  return encodeFunctionData({
    abi: minterRecoveryAbi,
    functionName: "reverseRepay",
    args: [
      BigInt(loanId),
      BigInt(repaymentId),
      checkRefHash("encodeEvmReverseRepayCalldata", refHash),
    ],
  });
}

export function encodeEvmRepayCalldata({
  loanId,
  repayment,
  valueDate,
  refHash,
  saleId = 0,
}: EvmRepayArgs): Hex {
  return encodeFunctionData({
    abi: minterRecoveryAbi,
    functionName: "repay",
    args: [
      BigInt(loanId),
      {
        offtakerReceived: BigInt(repayment.offtaker_received),
        seniorPrincipalRepaid: BigInt(repayment.senior_principal_repaid),
        seniorInterest: BigInt(repayment.senior_interest),
        equityDistributed: BigInt(repayment.equity_distributed),
        mgmtFee: BigInt(repayment.mgmt_fee),
        perfFee: BigInt(repayment.perf_fee),
        oetAlloc: BigInt(repayment.oet_alloc),
      },
      BigInt(valueDate),
      checkRefHash("encodeEvmRepayCalldata", refHash),
      BigInt(saleId),
    ],
  });
}
