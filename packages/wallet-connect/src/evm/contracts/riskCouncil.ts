// spec: docs/frontend/trustee-flows.md#risk-council-actions
import {
  encodeFunctionData,
  isAddress,
  toFunctionSelector,
  type Abi,
  type AbiFunction,
  type Address,
  type Hex,
} from "viem";
import type {
  OperationSchedule,
  RelayMode,
  RelayResult,
  RelayStage,
} from "../../stellar/contracts/accessManager";
import type {
  LoanChainState,
  LoanMoney,
  RiskCouncilCall,
} from "../../stellar/contracts/riskCouncil";
import { readEvmOperationSchedule, relayEvm } from "./accessManager";
import { readEvmContract } from "./write";

const loanRegistryErrors = [
  { type: "error", name: "LoanRegistryAlreadyClosed", inputs: [] },
  {
    type: "error",
    name: "LoanRegistryAmountExceedsOutstanding",
    inputs: [{ name: "outstanding", type: "uint256" }],
  },
  { type: "error", name: "LoanRegistryCarvedOut", inputs: [] },
  {
    type: "error",
    name: "LoanRegistryCounterpartOverreported",
    inputs: [
      { name: "requested", type: "uint256" },
      { name: "reported", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "LoanRegistryDisbursementExceedsTranche",
    inputs: [
      { name: "disbursed", type: "uint256" },
      { name: "originalSeniorTranche", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "LoanRegistryFeesExceedCap",
    inputs: [{ name: "feeCap", type: "uint256" }],
  },
  {
    type: "error",
    name: "LoanRegistryInterestExceedsMax",
    inputs: [{ name: "maxInterest", type: "uint256" }],
  },
  { type: "error", name: "LoanRegistryInvalidAmount", inputs: [] },
  { type: "error", name: "LoanRegistryInvalidClosureReason", inputs: [] },
  { type: "error", name: "LoanRegistryInvalidMaturityDate", inputs: [] },
  { type: "error", name: "LoanRegistryInvalidMaxFeeBps", inputs: [] },
  { type: "error", name: "LoanRegistryInvalidOfftakerPrice", inputs: [] },
  { type: "error", name: "LoanRegistryInvalidTranches", inputs: [] },
  { type: "error", name: "LoanRegistryNonExistentLoanId", inputs: [] },
  { type: "error", name: "LoanRegistryNonExistentRepayment", inputs: [] },
  { type: "error", name: "LoanRegistryNonTransferrable", inputs: [] },
  { type: "error", name: "LoanRegistryNonZeroOnDefault", inputs: [] },
  { type: "error", name: "LoanRegistryNotConfigured", inputs: [] },
  { type: "error", name: "LoanRegistryNotMatured", inputs: [] },
  {
    type: "error",
    name: "LoanRegistryOfftakerExceedsPrice",
    inputs: [
      { name: "cumulativeOfftakerReceived", type: "uint256" },
      { name: "originalOfftakerPrice", type: "uint256" },
    ],
  },
  { type: "error", name: "LoanRegistryOutstandingNotZero", inputs: [] },
  {
    type: "error",
    name: "LoanRegistryRepaidExceedsDisbursed",
    inputs: [
      { name: "repaidAndWrittenDown", type: "uint256" },
      { name: "disbursed", type: "uint256" },
    ],
  },
  { type: "error", name: "LoanRegistryRepaymentAlreadyReversed", inputs: [] },
  {
    type: "error",
    name: "LoanRegistryResidualExceedsMax",
    inputs: [
      { name: "residual", type: "uint256" },
      { name: "maxResidual", type: "uint256" },
    ],
  },
  { type: "error", name: "LoanRegistrySameValue", inputs: [] },
  {
    type: "error",
    name: "LoanRegistryWrongCurrentStatus",
    inputs: [{ name: "currentStatus", type: "uint8" }],
  },
  { type: "error", name: "LoanRegistryWrongRepaymentData", inputs: [] },
  { type: "error", name: "LoanRegistryZeroAddress", inputs: [] },
  { type: "error", name: "EnforcedPause", inputs: [] },
] as const;

export const evmLoanRegistryRiskCouncilAbi = [
  {
    type: "function",
    name: "setDefault",
    inputs: [{ name: "loanId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "cure",
    inputs: [{ name: "loanId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "amendEconomics",
    inputs: [
      { name: "loanId", type: "uint256" },
      { name: "newRate", type: "uint32" },
      { name: "newMaturityTimestamp", type: "uint64" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "adjustInterest",
    inputs: [
      { name: "loanId", type: "uint256" },
      { name: "delta", type: "int256" },
      { name: "reasonHash", type: "bytes32" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "writeDown",
    inputs: [
      { name: "loanId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "closeDefaulted",
    inputs: [
      { name: "loanId", type: "uint256" },
      { name: "reason", type: "uint8" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "mutableLoanData",
    inputs: [{ name: "loanId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "nextEconomicsEpochsId", type: "uint256" },
          { name: "nextRepaymentId", type: "uint256" },
          { name: "status", type: "uint8" },
          { name: "currentMaturityTimestamp", type: "uint64" },
          { name: "currentRate", type: "uint32" },
          { name: "closureReason", type: "uint8" },
          { name: "carvedOut", type: "bool" },
          { name: "disbursed", type: "uint256" },
          { name: "repaid", type: "uint256" },
          { name: "writtenDown", type: "uint256" },
          { name: "interestAdjustment", type: "int256" },
          { name: "metadataURI", type: "string" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "loanMoney",
    inputs: [{ name: "loanId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "disbursed", type: "uint256" },
          { name: "repaid", type: "uint256" },
          { name: "writtenDown", type: "uint256" },
          { name: "outstanding", type: "uint256" },
          { name: "accruedInterest", type: "uint256" },
          { name: "carvedOut", type: "bool" },
        ],
      },
    ],
    stateMutability: "view",
  },
  ...loanRegistryErrors,
] as const;

export const evmRiskCouncilErrorAbi: Abi = loanRegistryErrors;

export const EVM_RISK_COUNCIL_FUNCTION_NAMES: Readonly<
  Record<RiskCouncilCall["fn"], string>
> = {
  set_default: "setDefault",
  cure: "cure",
  amend_economics: "amendEconomics",
  adjust_interest: "adjustInterest",
  write_down: "writeDown",
  close_defaulted: "closeDefaulted",
};

export const EVM_LOAN_STATUSES = [
  "Approved",
  "Performing",
  "WatchList",
  "Default",
  "Closed",
] as const;

export const EVM_CLOSURE_REASONS = [
  "None",
  "ScheduledMaturity",
  "EarlyRepayment",
  "Cancelled",
  "Default",
  "OtherWriteDown",
] as const;

const MAX_RATE_BPS = 10_000;
const RATE_SCALE = 100;
const UINT256_MAX = 2n ** 256n - 1n;
const INT256_MAX = 2n ** 255n - 1n;
const INT256_MIN = -(2n ** 255n);
const BASE_UNIT_INT = /^[0-9]+$/;
const SIGNED_INT = /^-?[0-9]+$/;
const HEX32 = /^[0-9a-f]{64}$/;

function fail(what: string, value: unknown): never {
  throw new Error(`encodeEvmRiskCouncilCalldata: invalid ${what} ${value}`);
}

function idArg(value: number): bigint {
  if (!Number.isSafeInteger(value) || value < 0) fail("loanId", value);
  return BigInt(value);
}

export function evmRiskCouncilSelector(fn: RiskCouncilCall["fn"]): Hex {
  const name = EVM_RISK_COUNCIL_FUNCTION_NAMES[fn];
  const item = (evmLoanRegistryRiskCouncilAbi as Abi).find(
    (entry): entry is AbiFunction =>
      entry.type === "function" && entry.name === name,
  );
  if (!item) throw new Error(`evmRiskCouncilSelector: unknown function ${fn}`);
  return toFunctionSelector(item);
}

export function encodeEvmRiskCouncilCalldata(call: RiskCouncilCall): Hex {
  const loanId = idArg(call.loanId);
  switch (call.fn) {
    case "set_default":
      return encodeFunctionData({
        abi: evmLoanRegistryRiskCouncilAbi,
        functionName: "setDefault",
        args: [loanId],
      });
    case "cure":
      return encodeFunctionData({
        abi: evmLoanRegistryRiskCouncilAbi,
        functionName: "cure",
        args: [loanId],
      });
    case "amend_economics": {
      if (
        !Number.isInteger(call.rateBps) ||
        call.rateBps < 1 ||
        call.rateBps > MAX_RATE_BPS
      ) {
        fail("rateBps", call.rateBps);
      }
      if (!Number.isSafeInteger(call.maturity) || call.maturity <= 0) {
        fail("maturity", call.maturity);
      }
      return encodeFunctionData({
        abi: evmLoanRegistryRiskCouncilAbi,
        functionName: "amendEconomics",
        args: [loanId, call.rateBps * RATE_SCALE, BigInt(call.maturity)],
      });
    }
    case "adjust_interest": {
      if (!SIGNED_INT.test(call.delta)) fail("delta", call.delta);
      const delta = BigInt(call.delta);
      if (delta === 0n || delta > INT256_MAX || delta < INT256_MIN) {
        fail("delta", call.delta);
      }
      if (!HEX32.test(call.reasonHash)) fail("reasonHash", call.reasonHash);
      return encodeFunctionData({
        abi: evmLoanRegistryRiskCouncilAbi,
        functionName: "adjustInterest",
        args: [loanId, delta, `0x${call.reasonHash}`],
      });
    }
    case "write_down": {
      if (!BASE_UNIT_INT.test(call.amount)) fail("amount", call.amount);
      const amount = BigInt(call.amount);
      if (amount === 0n || amount > UINT256_MAX) fail("amount", call.amount);
      return encodeFunctionData({
        abi: evmLoanRegistryRiskCouncilAbi,
        functionName: "writeDown",
        args: [loanId, amount],
      });
    }
    case "close_defaulted": {
      if (call.reason !== "Default" && call.reason !== "OtherWriteDown") {
        fail("reason", call.reason);
      }
      return encodeFunctionData({
        abi: evmLoanRegistryRiskCouncilAbi,
        functionName: "closeDefaulted",
        args: [loanId, EVM_CLOSURE_REASONS.indexOf(call.reason)],
      });
    }
    default:
      throw new Error("encodeEvmRiskCouncilCalldata: unknown function");
  }
}

export interface EvmRiskCouncilCallParams {
  call: RiskCouncilCall;
  accessManager: string;
  registry: string;
  caller: string;
}

export interface RelayEvmRiskCouncilParams extends EvmRiskCouncilCallParams {
  mode: RelayMode;
  chainId: number;
  onStageChange?: (stage: RelayStage) => void;
}

export function relayEvmRiskCouncil({
  call,
  registry,
  ...rest
}: RelayEvmRiskCouncilParams): Promise<RelayResult> {
  return relayEvm({
    ...rest,
    target: registry,
    data: encodeEvmRiskCouncilCalldata(call),
    errorAbi: evmRiskCouncilErrorAbi,
  });
}

export function readEvmRiskCouncilSchedule({
  call,
  registry,
  ...rest
}: EvmRiskCouncilCallParams): Promise<OperationSchedule> {
  return readEvmOperationSchedule({
    ...rest,
    target: registry,
    data: encodeEvmRiskCouncilCalldata(call),
  });
}

export interface ReadEvmLoanParams {
  registry: string;
  loanId: number;
  blockNumber?: bigint;
}

interface MutableLoanData {
  nextEconomicsEpochsId: bigint;
  nextRepaymentId: bigint;
  status: number;
  currentMaturityTimestamp: bigint;
  currentRate: number;
  closureReason: number;
  carvedOut: boolean;
  disbursed: bigint;
  repaid: bigint;
  writtenDown: bigint;
  interestAdjustment: bigint;
  metadataURI: string;
}

interface EvmLoanMoneyData {
  disbursed: bigint;
  repaid: bigint;
  writtenDown: bigint;
  outstanding: bigint;
  accruedInterest: bigint;
  carvedOut: boolean;
}

function readLoanId(who: string, loanId: number): bigint {
  if (!Number.isSafeInteger(loanId) || loanId < 0) {
    throw new Error(`${who}: invalid loanId ${loanId}`);
  }
  return BigInt(loanId);
}

export function requireEvmRegistry(registry: string, who: string): Address {
  if (!registry) throw new Error(`${who}: registry must not be empty`);
  if (!isAddress(registry))
    throw new Error(`${who}: invalid registry ${registry}`);
  return registry;
}

export function readEvmMutableLoanData(
  who: string,
  { registry, loanId, blockNumber }: ReadEvmLoanParams,
): Promise<MutableLoanData> {
  const address = requireEvmRegistry(registry, who);
  return readEvmContract<MutableLoanData>({
    abi: evmLoanRegistryRiskCouncilAbi,
    address,
    functionName: "mutableLoanData",
    args: [readLoanId(who, loanId)],
    blockNumber,
  });
}

function ordinalName(
  names: readonly string[],
  ordinal: number | bigint,
  what: string,
): string {
  const name = names[Number(ordinal)];
  if (name === undefined) {
    throw new Error(`readEvmLoanChainState: unknown ${what} ${ordinal}`);
  }
  return name;
}

export async function readEvmLoanChainState(
  params: ReadEvmLoanParams,
): Promise<LoanChainState> {
  const data = await readEvmMutableLoanData("readEvmLoanChainState", params);
  return {
    status: ordinalName(EVM_LOAN_STATUSES, data.status, "status"),
    closureReason: ordinalName(
      EVM_CLOSURE_REASONS,
      data.closureReason,
      "closure reason",
    ),
    currentRate: Number(data.currentRate),
    currentMaturity: Number(data.currentMaturityTimestamp),
    interestAdjustment: data.interestAdjustment.toString(),
    writtenDown: data.writtenDown.toString(),
    carvedOut: data.carvedOut === true,
    metadataUri: data.metadataURI ?? "",
  };
}

export async function readEvmLoanMoney({
  registry,
  loanId,
}: ReadEvmLoanParams): Promise<LoanMoney> {
  const address = requireEvmRegistry(registry, "readEvmLoanMoney");
  const data = await readEvmContract<EvmLoanMoneyData>({
    abi: evmLoanRegistryRiskCouncilAbi,
    address,
    functionName: "loanMoney",
    args: [readLoanId("readEvmLoanMoney", loanId)],
  });
  return {
    accruedInterest: data.accruedInterest.toString(),
    carvedOut: data.carvedOut === true,
    disbursed: data.disbursed.toString(),
    outstanding: data.outstanding.toString(),
    repaid: data.repaid.toString(),
    writtenDown: data.writtenDown.toString(),
  };
}
