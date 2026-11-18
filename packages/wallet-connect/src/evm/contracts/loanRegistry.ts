// spec: docs/frontend/trustee-flows.md#chain-first-approve-ordering-831
import {
  BaseError,
  ContractFunctionRevertedError,
  encodeFunctionData,
  isAddress,
  parseEventLogs,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import type {
  DrawLoanArgs,
  DrawLoanStage,
} from "../../stellar/contracts/loanRegistry";
import { accessManagerAbi } from "./accessManager";
import { evmLoanRegistryErrorAbi } from "./riskCouncil";
import { sendEvmContractCall } from "./write";

export const evmLoanRegistryDrawAbi = [
  {
    type: "function",
    name: "drawLoan",
    inputs: [
      { name: "metadataURI", type: "string" },
      {
        name: "economics",
        type: "tuple",
        components: [
          { name: "borrowerRef", type: "bytes32" },
          { name: "originalFacilitySize", type: "uint256" },
          { name: "originalSeniorTranche", type: "uint256" },
          { name: "originalEquityTranche", type: "uint256" },
          { name: "originalOfftakerPrice", type: "uint256" },
          { name: "seniorInterestRate", type: "uint32" },
          { name: "originationDate", type: "uint64" },
          { name: "originalMaturityDate", type: "uint64" },
        ],
      },
    ],
    outputs: [{ name: "loanId", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "LoanDrawn",
    inputs: [
      { name: "loanId", type: "uint256", indexed: true },
      { name: "metadataURI", type: "string", indexed: false },
    ],
    anonymous: false,
  },
] as const;

const UINT256_MAX = 2n ** 256n - 1n;
const U32_MAX = 4_294_967_295;
const HEX32 = /^[0-9a-fA-F]{64}$/;
const BASE_UNIT_INT = /^[0-9]+$/;

function invalidInput(field: string, hint = ""): Error {
  return new Error(`drawEvmLoan: invalid draw_loan input ${field}${hint}`);
}

function parseAmount(value: unknown, field: string): bigint {
  if (typeof value !== "string" || !BASE_UNIT_INT.test(value)) {
    throw invalidInput(
      `economics.${field}`,
      " (expected a base-unit integer string)",
    );
  }
  const n = BigInt(value);
  if (n > UINT256_MAX) {
    throw invalidInput(`economics.${field}`, " (exceeds uint256)");
  }
  return n;
}

function parseDate(value: unknown, field: string): bigint {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw invalidInput(`economics.${field}`, " (expected unix seconds)");
  }
  return BigInt(value);
}

function parseRate(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > U32_MAX
  ) {
    throw invalidInput("economics.senior_interest_rate", " (expected a u32)");
  }
  return value;
}

function parseBorrowerRef(value: unknown): Hex {
  if (typeof value !== "string" || !HEX32.test(value)) {
    throw invalidInput(
      "economics.borrower_ref",
      " (expected 32 bytes as 64 hex characters)",
    );
  }
  return `0x${value.toLowerCase()}`;
}

export function encodeEvmDrawLoanCalldata(args: DrawLoanArgs): Hex {
  if (
    typeof args?.metadata_uri !== "string" ||
    args.metadata_uri.trim() === ""
  ) {
    throw invalidInput("metadata_uri");
  }
  const economics = args.economics;
  if (typeof economics !== "object" || economics === null) {
    throw invalidInput("economics");
  }
  return encodeFunctionData({
    abi: evmLoanRegistryDrawAbi,
    functionName: "drawLoan",
    args: [
      args.metadata_uri,
      {
        borrowerRef: parseBorrowerRef(economics.borrower_ref),
        originalFacilitySize: parseAmount(
          economics.original_facility_size,
          "original_facility_size",
        ),
        originalSeniorTranche: parseAmount(
          economics.original_senior_tranche,
          "original_senior_tranche",
        ),
        originalEquityTranche: parseAmount(
          economics.original_equity_tranche,
          "original_equity_tranche",
        ),
        originalOfftakerPrice: parseAmount(
          economics.original_offtaker_price,
          "original_offtaker_price",
        ),
        seniorInterestRate: parseRate(economics.senior_interest_rate),
        originationDate: parseDate(
          economics.origination_date,
          "origination_date",
        ),
        originalMaturityDate: parseDate(
          economics.original_maturity_date,
          "original_maturity_date",
        ),
      },
    ],
  });
}

export function readEvmDrawnLoanId(
  receipt: Pick<TransactionReceipt, "logs">,
  registry: string,
): number | null {
  const wanted = registry.toLowerCase();
  const logs = parseEventLogs({
    abi: evmLoanRegistryDrawAbi,
    eventName: "LoanDrawn",
    logs: receipt.logs,
    strict: false,
  });
  for (const log of logs) {
    if (log.address.toLowerCase() !== wanted) continue;
    const id = log.args.loanId;
    if (typeof id !== "bigint") continue;
    return id <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(id) : null;
  }
  return null;
}

export interface DrawEvmLoanParams {
  accessManager: string;
  registry: string;
  caller: string;
  chainId: number;
  args: DrawLoanArgs;
  onStageChange?: (stage: DrawLoanStage) => void;
}

export interface DrawEvmLoanResult {
  hash: Hex;
  loanId: number | null;
}

function requireAddress(name: string, value: string): Address {
  if (!value) throw new Error(`drawEvmLoan: ${name} must not be empty`);
  if (!isAddress(value)) {
    throw new Error(`drawEvmLoan: invalid ${name} ${value}`);
  }
  return value;
}

function isContractRevert(err: unknown): boolean {
  return (
    err instanceof BaseError &&
    err.walk((e) => e instanceof ContractFunctionRevertedError) !== null
  );
}

export async function drawEvmLoan({
  accessManager,
  registry,
  caller,
  chainId,
  args,
  onStageChange,
}: DrawEvmLoanParams): Promise<DrawEvmLoanResult> {
  const managerAddress = requireAddress("accessManager", accessManager);
  const registryAddress = requireAddress("registry", registry);
  requireAddress("caller", caller);
  const calldata = encodeEvmDrawLoanCalldata(args);

  let prompted = false;
  try {
    const { hash, receipt } = await sendEvmContractCall({
      abi: [...accessManagerAbi, ...evmLoanRegistryErrorAbi],
      address: managerAddress,
      functionName: "execute",
      args: [registryAddress, calldata],
      value: 0n,
      account: caller,
      chainId,
      onStageChange: (stage) => {
        if (stage === "awaiting-signature") prompted = true;
        onStageChange?.(stage);
      },
    });
    return { hash, loanId: readEvmDrawnLoanId(receipt, registryAddress) };
  } catch (err) {
    if (!prompted && isContractRevert(err)) {
      throw new Error(
        `drawEvmLoan: simulation error: ${(err as Error).message}`,
      );
    }
    throw err;
  }
}
