// spec: docs/frontend/trustee-flows.md#disburse-1898
import {
  BaseError,
  ContractFunctionRevertedError,
  getAddress,
  isAddress,
  type Abi,
} from "viem";
import type { DealRead } from "../../stellar/contracts/dealTokenFactory";
import { readEvmContract } from "./write";

export const evmDealNotRegisteredErrorAbi = [
  {
    type: "error",
    name: "DealTokenFactoryNotRegistered",
    inputs: [{ name: "loanId", type: "uint256" }],
  },
] as const;

export const evmDealTokenFactoryAbi = [
  {
    type: "function",
    name: "deal",
    inputs: [{ name: "loanId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [{ name: "debt", type: "address" }],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "error",
    name: "DealTokenFactoryAlreadyRegistered",
    inputs: [{ name: "loanId", type: "uint256" }],
  },
  ...evmDealNotRegisteredErrorAbi,
  { type: "error", name: "DealTokenFactoryZeroAddress", inputs: [] },
  { type: "error", name: "DealTokenFactorySameValue", inputs: [] },
] as const satisfies Abi;

function isNotRegistered(err: unknown): boolean {
  if (!(err instanceof BaseError)) return false;
  const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
  return (
    reverted instanceof ContractFunctionRevertedError &&
    reverted.data?.errorName === "DealTokenFactoryNotRegistered"
  );
}

export async function readEvmDeal({
  factory,
  loanId,
}: {
  factory: string;
  loanId: number;
}): Promise<DealRead | null> {
  if (!factory) throw new Error("readEvmDeal: factory must not be empty");
  if (!isAddress(factory)) {
    throw new Error(`readEvmDeal: invalid factory ${factory}`);
  }
  if (!Number.isSafeInteger(loanId) || loanId < 0) {
    throw new Error(`readEvmDeal: invalid loanId ${loanId}`);
  }
  try {
    const data = await readEvmContract<{ debt: string }>({
      abi: evmDealTokenFactoryAbi,
      address: factory,
      functionName: "deal",
      args: [BigInt(loanId)],
    });
    return { debt: getAddress(data.debt) };
  } catch (err) {
    if (isNotRegistered(err)) return null;
    throw err;
  }
}
