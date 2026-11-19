// spec: docs/frontend/trustee-flows.md#risk-council-pending-operations
import { isAddress, type Abi, type Address, type Hex } from "viem";
import type {
  CanCall,
  OperationSchedule,
  RelayMode,
  RelayResult,
  RelayStage,
} from "../../stellar/contracts/accessManager";
import { readEvmContract, sendEvmContractCall } from "./write";

export const accessManagerAbi = [
  {
    type: "function",
    name: "canCall",
    inputs: [
      { name: "caller", type: "address" },
      { name: "target", type: "address" },
      { name: "selector", type: "bytes4" },
    ],
    outputs: [
      { name: "immediate", type: "bool" },
      { name: "delay", type: "uint32" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "execute",
    inputs: [
      { name: "target", type: "address" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ name: "", type: "uint32" }],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "getSchedule",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [{ name: "", type: "uint48" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "hashOperation",
    inputs: [
      { name: "caller", type: "address" },
      { name: "target", type: "address" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "schedule",
    inputs: [
      { name: "target", type: "address" },
      { name: "data", type: "bytes" },
      { name: "when", type: "uint48" },
    ],
    outputs: [
      { name: "operationId", type: "bytes32" },
      { name: "nonce", type: "uint32" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "error",
    name: "AccessManagerAlreadyScheduled",
    inputs: [{ name: "operationId", type: "bytes32" }],
  },
  { type: "error", name: "AccessManagerBadConfirmation", inputs: [] },
  {
    type: "error",
    name: "AccessManagerExpired",
    inputs: [{ name: "operationId", type: "bytes32" }],
  },
  {
    type: "error",
    name: "AccessManagerInvalidInitialAdmin",
    inputs: [{ name: "initialAdmin", type: "address" }],
  },
  {
    type: "error",
    name: "AccessManagerLockedRole",
    inputs: [{ name: "roleId", type: "uint64" }],
  },
  {
    type: "error",
    name: "AccessManagerNotReady",
    inputs: [{ name: "operationId", type: "bytes32" }],
  },
  {
    type: "error",
    name: "AccessManagerNotScheduled",
    inputs: [{ name: "operationId", type: "bytes32" }],
  },
  {
    type: "error",
    name: "AccessManagerUnauthorizedAccount",
    inputs: [
      { name: "msgsender", type: "address" },
      { name: "roleId", type: "uint64" },
    ],
  },
  {
    type: "error",
    name: "AccessManagerUnauthorizedCall",
    inputs: [
      { name: "caller", type: "address" },
      { name: "target", type: "address" },
      { name: "selector", type: "bytes4" },
    ],
  },
  {
    type: "error",
    name: "AccessManagerUnauthorizedCancel",
    inputs: [
      { name: "msgsender", type: "address" },
      { name: "caller", type: "address" },
      { name: "target", type: "address" },
      { name: "selector", type: "bytes4" },
    ],
  },
  {
    type: "error",
    name: "AccessManagerUnauthorizedConsume",
    inputs: [{ name: "target", type: "address" }],
  },
] as const;

const CALLDATA = /^0x([0-9a-f]{2}){4,}$/i;

export interface EvmAccessManagerCallParams {
  accessManager: string;
  caller: string;
  target: string;
}

export interface ReadEvmCanCallParams extends EvmAccessManagerCallParams {
  selector: Hex;
}

export interface ReadEvmOperationScheduleParams extends EvmAccessManagerCallParams {
  data: string;
}

export interface RelayEvmParams extends ReadEvmOperationScheduleParams {
  mode: RelayMode;
  chainId: number;
  errorAbi?: Abi;
  onStageChange?: (stage: RelayStage) => void;
}

export interface ReadEvmScheduledOperationParams extends EvmAccessManagerCallParams {
  calldata: string;
}

export interface ExecuteEvmScheduledOperationParams extends ReadEvmScheduledOperationParams {
  chainId: number;
  errorAbi?: Abi;
  onStageChange?: (stage: RelayStage) => void;
}

function requireAddresses(
  who: string,
  { accessManager, caller, target }: EvmAccessManagerCallParams,
): void {
  if (!accessManager) {
    throw new Error(`${who}: accessManager must not be empty`);
  }
  if (!caller) throw new Error(`${who}: caller must not be empty`);
  if (!target) throw new Error(`${who}: target must not be empty`);
  for (const [name, value] of [
    ["accessManager", accessManager],
    ["caller", caller],
    ["target", target],
  ] as const) {
    if (!isAddress(value)) throw new Error(`${who}: invalid ${name} ${value}`);
  }
}

function requireCalldata(who: string, data: string): Hex {
  if (!CALLDATA.test(data)) throw new Error(`${who}: invalid calldata`);
  return data as Hex;
}

export async function readEvmCanCall(
  params: ReadEvmCanCallParams,
): Promise<CanCall> {
  requireAddresses("readEvmCanCall", params);
  const [immediate, delay] = await readEvmContract<readonly [boolean, number]>({
    abi: accessManagerAbi,
    address: params.accessManager as Address,
    functionName: "canCall",
    args: [params.caller, params.target, params.selector],
  });
  return { immediate: immediate === true, delay: Number(delay ?? 0) };
}

export async function readEvmOperationSchedule(
  params: ReadEvmOperationScheduleParams,
): Promise<OperationSchedule> {
  requireAddresses("readEvmOperationSchedule", params);
  const data = requireCalldata("readEvmOperationSchedule", params.data);
  const address = params.accessManager as Address;
  const hash = await readEvmContract<Hex>({
    abi: accessManagerAbi,
    address,
    functionName: "hashOperation",
    args: [params.caller, params.target, data],
  });
  const readyAt = await readEvmContract<number | bigint>({
    abi: accessManagerAbi,
    address,
    functionName: "getSchedule",
    args: [hash],
  });
  return {
    operationId: hash.slice(2).toLowerCase(),
    readyAt: Number(readyAt),
  };
}

export function relayEvm({
  mode,
  accessManager,
  caller,
  target,
  data,
  chainId,
  errorAbi = [],
  onStageChange,
}: RelayEvmParams): Promise<RelayResult> {
  requireAddresses("relayEvm", { accessManager, caller, target });
  const calldata = requireCalldata("relayEvm", data);
  return sendEvmContractCall({
    abi: [...accessManagerAbi, ...errorAbi],
    address: accessManager as Address,
    functionName: mode,
    args: mode === "schedule" ? [target, calldata, 0] : [target, calldata],
    ...(mode === "execute" ? { value: 0n } : {}),
    account: caller,
    chainId,
    onStageChange,
  });
}

export function readEvmScheduledOperation({
  calldata,
  ...rest
}: ReadEvmScheduledOperationParams): Promise<OperationSchedule> {
  return readEvmOperationSchedule({ ...rest, data: calldata });
}

export function executeEvmScheduledOperation({
  calldata,
  ...rest
}: ExecuteEvmScheduledOperationParams): Promise<RelayResult> {
  return relayEvm({ ...rest, mode: "execute", data: calldata });
}
