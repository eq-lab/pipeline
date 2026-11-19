// spec: docs/frontend/trustee-flows.md#wired-actions
import {
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
  RolloverStage,
} from "../../stellar/contracts/loanRegistry";
import { accessManagerAbi } from "./accessManager";
import {
  EVM_CLOSURE_REASONS,
  EVM_LOAN_STATUSES,
  evmLoanRegistryErrorAbi,
} from "./riskCouncil";
import { sendEvmContractCallChecked } from "./write";

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

function requireAddress(
  name: string,
  value: string,
  who = "drawEvmLoan",
): Address {
  if (!value) throw new Error(`${who}: ${name} must not be empty`);
  if (!isAddress(value)) {
    throw new Error(`${who}: invalid ${name} ${value}`);
  }
  return value;
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

  const { hash, receipt } = await sendEvmContractCallChecked("drawEvmLoan", {
    abi: [...accessManagerAbi, ...evmLoanRegistryErrorAbi],
    address: managerAddress,
    functionName: "execute",
    args: [registryAddress, calldata],
    value: 0n,
    account: caller,
    chainId,
    onStageChange,
  });
  return { hash, loanId: readEvmDrawnLoanId(receipt, registryAddress) };
}

// ── lifecycle writes (rollover / updateMutable / closeLoan) ──────────────────

export const evmLoanRegistryLifecycleAbi = [
  {
    type: "function",
    name: "rollover",
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
    name: "updateMutable",
    inputs: [
      { name: "loanId", type: "uint256" },
      { name: "newStatus", type: "uint8" },
      { name: "metadataURI", type: "string" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "closeLoan",
    inputs: [
      { name: "loanId", type: "uint256" },
      { name: "reason", type: "uint8" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

const MAX_RATE_BPS = 10_000;
const RATE_SCALE = 100;

function failField(who: string, field: string, value: unknown): never {
  throw new Error(`${who}: invalid ${field} ${String(value)}`);
}

function loanIdArg(who: string, loanId: number): bigint {
  if (!Number.isSafeInteger(loanId) || loanId < 0) {
    failField(who, "loanId", loanId);
  }
  return BigInt(loanId);
}

function ordinalOf(
  who: string,
  field: string,
  names: readonly string[],
  value: string,
): number {
  const ordinal = names.indexOf(value);
  if (ordinal < 0) failField(who, field, value);
  return ordinal;
}

export function encodeEvmRolloverCalldata(
  loanId: number,
  newRateBps: number,
  newMaturity: number,
): Hex {
  const who = "encodeEvmRolloverCalldata";
  const id = loanIdArg(who, loanId);
  if (
    !Number.isInteger(newRateBps) ||
    newRateBps < 1 ||
    newRateBps > MAX_RATE_BPS
  ) {
    failField(who, "newRateBps", newRateBps);
  }
  if (!Number.isSafeInteger(newMaturity) || newMaturity <= 0) {
    failField(who, "newMaturity", newMaturity);
  }
  return encodeFunctionData({
    abi: evmLoanRegistryLifecycleAbi,
    functionName: "rollover",
    args: [id, newRateBps * RATE_SCALE, BigInt(newMaturity)],
  });
}

export function encodeEvmUpdateMutableCalldata(
  loanId: number,
  status: string,
  metadataUri: string,
): Hex {
  const who = "encodeEvmUpdateMutableCalldata";
  const id = loanIdArg(who, loanId);
  const ordinal = ordinalOf(who, "status", EVM_LOAN_STATUSES, status);
  if (typeof metadataUri !== "string") {
    failField(who, "metadataUri", metadataUri);
  }
  return encodeFunctionData({
    abi: evmLoanRegistryLifecycleAbi,
    functionName: "updateMutable",
    args: [id, ordinal, metadataUri],
  });
}

export function encodeEvmCloseLoanCalldata(
  loanId: number,
  reason: string,
): Hex {
  const who = "encodeEvmCloseLoanCalldata";
  const id = loanIdArg(who, loanId);
  const ordinal = ordinalOf(who, "reason", EVM_CLOSURE_REASONS, reason);
  if (ordinal === 0) failField(who, "reason", reason);
  return encodeFunctionData({
    abi: evmLoanRegistryLifecycleAbi,
    functionName: "closeLoan",
    args: [id, ordinal],
  });
}

export interface EvmLoanRegistryCallParams {
  accessManager: string;
  registry: string;
  caller: string;
  chainId: number;
  onStageChange?: (stage: RolloverStage) => void;
}

async function sendLifecycle(
  who: string,
  {
    accessManager,
    registry,
    caller,
    chainId,
    onStageChange,
  }: EvmLoanRegistryCallParams,
  encode: () => Hex,
): Promise<{ hash: Hex }> {
  const managerAddress = requireAddress("accessManager", accessManager, who);
  const registryAddress = requireAddress("registry", registry, who);
  requireAddress("caller", caller, who);
  const calldata = encode();
  const { hash } = await sendEvmContractCallChecked(who, {
    abi: [...accessManagerAbi, ...evmLoanRegistryErrorAbi],
    address: managerAddress,
    functionName: "execute",
    args: [registryAddress, calldata],
    value: 0n,
    account: caller,
    chainId,
    onStageChange,
  });
  return { hash };
}

export function rolloverEvmLoan({
  loanId,
  newRateBps,
  newMaturity,
  ...base
}: EvmLoanRegistryCallParams & {
  loanId: number;
  newRateBps: number;
  newMaturity: number;
}): Promise<{ hash: Hex }> {
  return sendLifecycle("rolloverEvmLoan", base, () =>
    encodeEvmRolloverCalldata(loanId, newRateBps, newMaturity),
  );
}

export function updateEvmMutable({
  loanId,
  status,
  metadataUri,
  ...base
}: EvmLoanRegistryCallParams & {
  loanId: number;
  status: string;
  metadataUri: string;
}): Promise<{ hash: Hex }> {
  return sendLifecycle("updateEvmMutable", base, () =>
    encodeEvmUpdateMutableCalldata(loanId, status, metadataUri),
  );
}

export function closeEvmLoan({
  loanId,
  reason,
  ...base
}: EvmLoanRegistryCallParams & {
  loanId: number;
  reason: string;
}): Promise<{ hash: Hex }> {
  return sendLifecycle("closeEvmLoan", base, () =>
    encodeEvmCloseLoanCalldata(loanId, reason),
  );
}
