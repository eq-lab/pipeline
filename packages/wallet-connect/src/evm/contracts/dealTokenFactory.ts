// spec: docs/frontend/trustee-flows.md#register-debt-token-1766
import {
  BaseError,
  ContractFunctionRevertedError,
  encodeFunctionData,
  getAddress,
  isAddress,
  toFunctionSelector,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import type {
  RelayMode,
  RelayStage,
} from "../../stellar/contracts/accessManager";
import type { DealRead } from "../../stellar/contracts/dealTokenFactory";
import { accessManagerAbi } from "./accessManager";
import { evmLoanRegistryErrorAbi } from "./riskCouncil";
import { readEvmContract, sendEvmContractCallChecked } from "./write";

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
    type: "function",
    name: "registerDeal",
    inputs: [{ name: "loanId", type: "uint256" }],
    outputs: [
      {
        name: "dealData",
        type: "tuple",
        components: [{ name: "debt", type: "address" }],
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "DealRegistered",
    inputs: [
      { name: "loanId", type: "uint256", indexed: true },
      { name: "debt", type: "address", indexed: false },
    ],
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

export const evmRegisterDealErrorAbi: Abi = [
  ...evmDealTokenFactoryAbi.filter((e) => e.type === "error"),
  ...evmLoanRegistryErrorAbi,
];

export function evmRegisterDealSelector(): Hex {
  const entry = evmDealTokenFactoryAbi.find(
    (e) => e.type === "function" && e.name === "registerDeal",
  )!;
  return toFunctionSelector(entry);
}

export function encodeEvmRegisterDealCalldata(loanId: number): Hex {
  if (!Number.isSafeInteger(loanId) || loanId < 0) {
    throw new Error(`encodeEvmRegisterDealCalldata: invalid loanId ${loanId}`);
  }
  return encodeFunctionData({
    abi: evmDealTokenFactoryAbi,
    functionName: "registerDeal",
    args: [BigInt(loanId)],
  });
}

export interface RelayEvmRegisterDealParams {
  mode: RelayMode;
  accessManager: string;
  factory: string;
  caller: string;
  loanId: number;
  chainId: number;
  onStageChange?: (stage: RelayStage) => void;
}

function requireAddress(name: string, value: string): Address {
  if (!isAddress(value)) {
    throw new Error(`registerEvmDeal: invalid ${name} ${value}`);
  }
  return value;
}

export async function relayEvmRegisterDeal({
  mode,
  accessManager,
  factory,
  caller,
  loanId,
  chainId,
  onStageChange,
}: RelayEvmRegisterDealParams): Promise<{ hash: Hex }> {
  const managerAddress = requireAddress("accessManager", accessManager);
  const factoryAddress = requireAddress("factory", factory);
  requireAddress("caller", caller);
  const calldata = encodeEvmRegisterDealCalldata(loanId);
  const { hash } = await sendEvmContractCallChecked("registerEvmDeal", {
    abi: [...accessManagerAbi, ...evmRegisterDealErrorAbi],
    address: managerAddress,
    functionName: mode,
    args:
      mode === "schedule"
        ? [factoryAddress, calldata, 0]
        : [factoryAddress, calldata],
    ...(mode === "execute" ? { value: 0n } : {}),
    account: caller,
    chainId,
    onStageChange,
  });
  return { hash };
}
