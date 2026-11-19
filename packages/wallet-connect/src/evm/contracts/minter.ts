// spec: docs/product-specs/loan-repayment-recovery.md
import {
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  isAddress,
  keccak256,
  parseEventLogs,
  toEventSelector,
  toFunctionSelector,
  toHex,
  type Abi,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import type {
  OperationSchedule,
  RelayMode,
  RelayResult,
  RelayStage,
} from "../../stellar/contracts/accessManager";
import { sha256Hex } from "../../stellar/contracts/hash";
import type { RepaymentInput } from "../../stellar/contracts/loanRegistry";
import type {
  MinterRepayment,
  RepayStage,
} from "../../stellar/contracts/minter";
import {
  accessManagerAbi,
  readEvmOperationSchedule,
  relayEvm,
} from "./accessManager";
import { requireAddress } from "./args";
import { evmDealNotRegisteredErrorAbi } from "./dealTokenFactory";
import { loanIdTopic, readEvmHeadBlock, scanEvmLogs } from "./logs";
import {
  evmLoanRegistryErrorAbi,
  evmRiskCouncilErrorAbi,
  readEvmMutableLoanData,
} from "./riskCouncil";
import { readEvmContract, sendEvmContractCallChecked } from "./write";

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

const UINT256_MAX = 2n ** 256n - 1n;
const DIGITS = /^[0-9]+$/;

function failField(who: string, field: string, value: unknown): never {
  throw new Error(`${who}: invalid ${field} ${String(value)}`);
}

function uintField(who: string, field: string, value: unknown): bigint {
  if (typeof value !== "string" || !DIGITS.test(value)) {
    failField(who, field, value);
  }
  const n = BigInt(value);
  if (n > UINT256_MAX) failField(who, field, value);
  return n;
}

function idField(who: string, field: string, value: number | bigint): bigint {
  if (typeof value === "bigint") {
    if (value < 0n || value > UINT256_MAX) failField(who, field, value);
    return value;
  }
  if (!Number.isSafeInteger(value) || value < 0) failField(who, field, value);
  return BigInt(value);
}

function repayArgs(
  who: string,
  { loanId, repayment, valueDate, refHash, saleId = 0 }: EvmRepayArgs,
) {
  const id = idField(who, "loanId", loanId);
  const date = Number(valueDate);
  if (!Number.isSafeInteger(date) || date <= 0) {
    failField(who, "valueDate", valueDate);
  }
  const sale = idField(who, "saleId", saleId);
  const data = {
    offtakerReceived: uintField(
      who,
      "offtaker_received",
      repayment.offtaker_received,
    ),
    seniorPrincipalRepaid: uintField(
      who,
      "senior_principal_repaid",
      repayment.senior_principal_repaid,
    ),
    seniorInterest: uintField(
      who,
      "senior_interest",
      repayment.senior_interest,
    ),
    equityDistributed: uintField(
      who,
      "equity_distributed",
      repayment.equity_distributed,
    ),
    mgmtFee: uintField(who, "mgmt_fee", repayment.mgmt_fee),
    perfFee: uintField(who, "perf_fee", repayment.perf_fee),
    oetAlloc: uintField(who, "oet_alloc", repayment.oet_alloc),
  };
  return [id, data, BigInt(date), checkRefHash(who, refHash), sale] as const;
}

export function encodeEvmRepayCalldata(args: EvmRepayArgs): Hex {
  return encodeFunctionData({
    abi: minterRecoveryAbi,
    functionName: "repay",
    args: repayArgs("encodeEvmRepayCalldata", args),
  });
}

const minterErrors = [
  { type: "error", name: "MinterAlreadyReversed", inputs: [] },
  {
    type: "error",
    name: "MinterAmountMismatch",
    inputs: [{ name: "expected", type: "uint256" }],
  },
  { type: "error", name: "MinterExceedsBookedYield", inputs: [] },
  {
    type: "error",
    name: "MinterInsufficientBankCash",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "bankCash", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "MinterInsufficientCustody",
    inputs: [{ name: "custody", type: "uint256" }],
  },
  { type: "error", name: "MinterInvalidAmount", inputs: [] },
  { type: "error", name: "MinterMissingRef", inputs: [] },
  { type: "error", name: "MinterNonExistentCashEntry", inputs: [] },
  { type: "error", name: "MinterNonExistentRamp", inputs: [] },
  { type: "error", name: "MinterNonExistentWireIn", inputs: [] },
  { type: "error", name: "MinterNonExistentWireOut", inputs: [] },
  {
    type: "error",
    name: "MinterPulledMoreThanRequested",
    inputs: [
      { name: "requested", type: "uint256" },
      { name: "pulled", type: "uint256" },
    ],
  },
  { type: "error", name: "MinterRampClosed", inputs: [] },
  {
    type: "error",
    name: "MinterReceivedExceedsAmount",
    inputs: [{ name: "amount", type: "uint256" }],
  },
  {
    type: "error",
    name: "MinterReceiverNotAllowed",
    inputs: [{ name: "receiver", type: "address" }],
  },
  { type: "error", name: "MinterRefHashSeen", inputs: [] },
  { type: "error", name: "MinterSameValue", inputs: [] },
  { type: "error", name: "MinterWrongEntry", inputs: [] },
  { type: "error", name: "MinterWrongWireStatus", inputs: [] },
  { type: "error", name: "MinterZeroAddress", inputs: [] },
] as const;

export const evmMinterErrorAbi: Abi = minterErrors;

export const evmRecoveryErrorAbi: Abi = [
  ...evmMinterErrorAbi,
  ...evmRiskCouncilErrorAbi,
];

export function evmReverseRepaySelector(): Hex {
  return toFunctionSelector(minterRecoveryAbi[0]);
}

export function evmRepaySelector(): Hex {
  return toFunctionSelector(minterRecoveryAbi[1]);
}

export async function evmReverseRepayRefHash({
  minter,
  loanId,
  repaymentId,
}: {
  minter: string;
  loanId: number;
  repaymentId: number;
}): Promise<Hex> {
  const digest = await sha256Hex(
    `pipeline:reverse_repay:${getAddress(minter)}:${loanId}:${repaymentId}`,
  );
  return `0x${digest}`;
}

export interface EvmReverseRepayCallParams {
  accessManager: string;
  minter: string;
  caller: string;
  loanId: number;
  repaymentId: number;
  refHash: string;
}

export interface RelayEvmReverseRepayParams extends EvmReverseRepayCallParams {
  mode: RelayMode;
  chainId: number;
  onStageChange?: (stage: RelayStage) => void;
}

export function relayEvmReverseRepay({
  minter,
  loanId,
  repaymentId,
  refHash,
  ...rest
}: RelayEvmReverseRepayParams): Promise<RelayResult> {
  return relayEvm({
    ...rest,
    target: minter,
    data: encodeEvmReverseRepayCalldata({ loanId, repaymentId, refHash }),
    errorAbi: evmRecoveryErrorAbi,
  });
}

export type ScheduleEvmReverseRepayParams = Omit<
  RelayEvmReverseRepayParams,
  "mode"
>;

export function scheduleEvmReverseRepay(
  params: ScheduleEvmReverseRepayParams,
): Promise<RelayResult> {
  return relayEvmReverseRepay({ ...params, mode: "schedule" });
}

export function executeEvmReverseRepay(
  params: ScheduleEvmReverseRepayParams,
): Promise<RelayResult> {
  return relayEvmReverseRepay({ ...params, mode: "execute" });
}

export function readEvmReverseRepaySchedule({
  minter,
  loanId,
  repaymentId,
  refHash,
  ...rest
}: EvmReverseRepayCallParams): Promise<OperationSchedule> {
  return readEvmOperationSchedule({
    ...rest,
    target: minter,
    data: encodeEvmReverseRepayCalldata({ loanId, repaymentId, refHash }),
  });
}

export async function readEvmNextRepaymentId(params: {
  registry: string;
  loanId: number;
  blockNumber?: bigint;
}): Promise<number> {
  const data = await readEvmMutableLoanData("readEvmNextRepaymentId", params);
  return Number(data.nextRepaymentId);
}

export const minterExtsloadAbi = [
  {
    type: "function",
    name: "extsload",
    inputs: [{ name: "slot", type: "bytes32" }],
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "view",
  },
] as const;

export const MINTER_STORAGE_SLOT: Hex =
  "0x1cb61fb8c91dfac98430b399e1cf1804c4c3862229ec367a9bc71c2a7e5cc100";
export const MINTER_REPAYMENTS_FIELD = 19n;

const SLOT_PAIR = [{ type: "uint256" }, { type: "bytes32" }] as const;

export function evmMinterRepaymentSlot(
  loanId: number | bigint,
  repaymentId: number | bigint,
): Hex {
  const field = toHex(BigInt(MINTER_STORAGE_SLOT) + MINTER_REPAYMENTS_FIELD, {
    size: 32,
  });
  const perLoan = keccak256(
    encodeAbiParameters(SLOT_PAIR, [BigInt(loanId), field]),
  );
  return keccak256(
    encodeAbiParameters(SLOT_PAIR, [BigInt(repaymentId), perLoan]),
  );
}

export interface EvmMinterRepaymentRecord {
  released: string;
  carvedOut: boolean;
}

export async function readEvmMinterRepayment({
  minter,
  loanId,
  repaymentId,
  blockNumber,
}: {
  minter: string;
  loanId: number;
  repaymentId: number;
  blockNumber?: bigint;
}): Promise<EvmMinterRepaymentRecord> {
  requireAddress("readEvmMinterRepayment", "minter", minter);
  const base = BigInt(evmMinterRepaymentSlot(loanId, repaymentId));
  const word = (offset: bigint) =>
    readEvmContract<Hex>({
      abi: minterExtsloadAbi,
      address: minter as Address,
      functionName: "extsload",
      args: [toHex(base + offset, { size: 32 })],
      blockNumber,
    });
  const [released, flags] = await Promise.all([word(2n), word(3n)]);
  return {
    released: BigInt(released).toString(),
    carvedOut: (BigInt(flags) & 0xffn) !== 0n,
  };
}

const recoveryEventsAbi = [
  {
    type: "event",
    name: "PaymentRecorded",
    inputs: [
      { name: "loanId", type: "uint256", indexed: true },
      { name: "repaymentId", type: "uint256", indexed: true },
      {
        name: "repayment",
        type: "tuple",
        indexed: false,
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
      { name: "outstanding", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "PaymentUnrecorded",
    inputs: [
      { name: "loanId", type: "uint256", indexed: true },
      { name: "repaymentId", type: "uint256", indexed: true },
      { name: "outstanding", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "CashRepaid",
    inputs: [
      { name: "loanId", type: "uint256", indexed: true },
      { name: "repaymentId", type: "uint256", indexed: false },
      { name: "saleId", type: "uint256", indexed: false },
      { name: "cash", type: "uint256", indexed: false },
      { name: "interestMinted", type: "uint256", indexed: false },
      { name: "feeShares", type: "uint256", indexed: false },
      { name: "valueDate", type: "uint64", indexed: false },
      { name: "refHash", type: "bytes32", indexed: false },
    ],
    anonymous: false,
  },
] as const;

export const EVM_RECOVERY_EVENT_TOPICS: readonly Hex[] = recoveryEventsAbi.map(
  (event) => toEventSelector(event),
);

export interface EvmRecoveryRepayment {
  repaymentId: number;
  repayment: RepaymentInput;
  minter: MinterRepayment;
  reversed: boolean;
}

export interface ReadEvmRecoveryRepaymentsParams {
  registry: string;
  minter: string;
  loanId: number;
  fromBlock: bigint;
  chainId: number;
}

export async function readEvmRecoveryRepayments({
  registry,
  minter,
  loanId,
  fromBlock,
  chainId,
}: ReadEvmRecoveryRepaymentsParams): Promise<EvmRecoveryRepayment[]> {
  if (!isAddress(minter)) {
    throw new Error(
      `VITE_EVM_MINTER_ADDRESS is not a valid EVM address: "${minter}".`,
    );
  }
  const head = await readEvmHeadBlock(chainId);
  const next = await readEvmNextRepaymentId({
    registry,
    loanId,
    blockNumber: head,
  });
  if (next === 0) return [];
  const logs = await scanEvmLogs({
    address: [registry as Address, minter as Address],
    topics: [[...EVM_RECOVERY_EVENT_TOPICS], loanIdTopic(loanId)],
    fromBlock,
    chainId,
    head,
  });
  const events = parseEventLogs({ abi: recoveryEventsAbi, logs });
  const loan = BigInt(loanId);
  const recorded = new Map<number, (typeof events)[number]>();
  const cash = new Map<number, (typeof events)[number]>();
  const unrecorded = new Set<number>();
  for (const event of events) {
    if (event.args.loanId !== loan) continue;
    const id = Number(event.args.repaymentId);
    if (event.eventName === "PaymentRecorded") recorded.set(id, event);
    else if (event.eventName === "CashRepaid") cash.set(id, event);
    else unrecorded.add(id);
  }
  return Promise.all(
    Array.from({ length: next }, async (_, repaymentId) => {
      const payment = recorded.get(repaymentId);
      const minted = cash.get(repaymentId);
      if (
        payment?.eventName !== "PaymentRecorded" ||
        minted?.eventName !== "CashRepaid"
      ) {
        throw new Error(
          `Repayment #${repaymentId} was not found on chain from block ${fromBlock}; check VITE_EVM_START_BLOCK.`,
        );
      }
      const record = await readEvmMinterRepayment({
        minter,
        loanId,
        repaymentId,
        blockNumber: head,
      });
      const data = payment.args.repayment;
      const reversed = unrecorded.has(repaymentId);
      return {
        repaymentId,
        repayment: {
          offtaker_received: data.offtakerReceived.toString(),
          senior_principal_repaid: data.seniorPrincipalRepaid.toString(),
          senior_interest: data.seniorInterest.toString(),
          equity_distributed: data.equityDistributed.toString(),
          mgmt_fee: data.mgmtFee.toString(),
          perf_fee: data.perfFee.toString(),
          oet_alloc: data.oetAlloc.toString(),
        },
        minter: {
          cash: minted.args.cash.toString(),
          principal: record.released,
          interestMinted: minted.args.interestMinted.toString(),
          feeShares: minted.args.feeShares.toString(),
          carvedOut: record.carvedOut,
          saleId: Number(minted.args.saleId),
          reversed,
        },
        reversed,
      };
    }),
  );
}

export const evmRepayErrorAbi: Abi = [
  ...evmMinterErrorAbi,
  ...evmLoanRegistryErrorAbi,
  { type: "error", name: "RateLimiterExceedsTxLimit", inputs: [] },
  { type: "error", name: "RateLimiterExceedsWindowLimit", inputs: [] },
  ...evmDealNotRegisteredErrorAbi,
  {
    type: "error",
    name: "AccessManagedUnauthorized",
    inputs: [{ name: "caller", type: "address" }],
  },
];

export async function evmRepaymentRefHash({
  registry,
  loanId,
  nextRepaymentId,
}: {
  registry: string;
  loanId: number;
  nextRepaymentId: number;
}): Promise<Hex> {
  const digest = await sha256Hex(
    `pipeline:repay:${getAddress(registry)}:${loanId}:${nextRepaymentId}`,
  );
  return `0x${digest}`;
}

export function readEvmRepaymentId(
  receipt: Pick<TransactionReceipt, "logs">,
  minter: string,
): number | null {
  const wanted = minter.toLowerCase();
  const logs = parseEventLogs({
    abi: recoveryEventsAbi,
    eventName: "CashRepaid",
    logs: receipt.logs,
    strict: false,
  });
  for (const log of logs) {
    if (log.address.toLowerCase() !== wanted) continue;
    const id = log.args.repaymentId;
    if (typeof id !== "bigint") continue;
    return id <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(id) : null;
  }
  return null;
}

export interface RepayEvmLoanParams extends EvmRepayArgs {
  minter: string;
  caller: string;
  chainId: number;
  onStageChange?: (stage: RepayStage) => void;
}

export async function repayEvmLoan({
  minter,
  caller,
  chainId,
  onStageChange,
  ...repay
}: RepayEvmLoanParams): Promise<{ hash: Hex; repaymentId: number | null }> {
  const who = "repayEvmLoan";
  const minterAddress = requireAddress(who, "minter", minter);
  requireAddress(who, "caller", caller);
  const args = repayArgs(who, repay);
  const { hash, receipt } = await sendEvmContractCallChecked(who, {
    abi: [minterRecoveryAbi[1], ...evmRepayErrorAbi],
    address: minterAddress,
    functionName: "repay",
    args,
    account: caller,
    chainId,
    onStageChange,
  });
  return { hash, repaymentId: readEvmRepaymentId(receipt, minterAddress) };
}

export const minterDisburseAbi = [
  {
    type: "function",
    name: "disburse",
    stateMutability: "nonpayable",
    inputs: [
      { name: "loanId", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "valueDate", type: "uint64" },
      { name: "refHash", type: "bytes32" },
    ],
    outputs: [{ name: "entryId", type: "uint256" }],
  },
  {
    type: "function",
    name: "bankCash",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "refHashSeen",
    stateMutability: "view",
    inputs: [{ name: "refHash", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "paused",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export const MINTER_BANK_CASH_FIELD = 8n;
export const MINTER_REF_HASHES_SEEN_FIELD = 20n;

export const evmDisburseErrorAbi: Abi = [
  ...evmMinterErrorAbi,
  ...evmLoanRegistryErrorAbi,
  ...evmDealNotRegisteredErrorAbi,
];

export function evmDisburseSelector(): Hex {
  return toFunctionSelector(minterDisburseAbi[0]);
}

export interface EvmDisburseArgs {
  loanId: number;
  amountRaw: string;
  valueDate: number;
  refHash: string;
}

function disburseArgs(
  who: string,
  { loanId, amountRaw, valueDate, refHash }: EvmDisburseArgs,
) {
  const id = idField(who, "loanId", loanId);
  const amount = uintField(who, "amountRaw", amountRaw);
  if (amount === 0n) failField(who, "amountRaw", amountRaw);
  if (!Number.isSafeInteger(valueDate) || valueDate <= 0) {
    failField(who, "valueDate", valueDate);
  }
  return [id, amount, BigInt(valueDate), checkRefHash(who, refHash)] as const;
}

export function encodeEvmDisburseCalldata(args: EvmDisburseArgs): Hex {
  return encodeFunctionData({
    abi: minterDisburseAbi,
    functionName: "disburse",
    args: disburseArgs("encodeEvmDisburseCalldata", args),
  });
}

export interface DisburseEvmLoanParams extends EvmDisburseArgs {
  accessManager: string;
  minter: string;
  caller: string;
  chainId: number;
  onStageChange?: (stage: RepayStage) => void;
}

export async function disburseEvmLoan({
  accessManager,
  minter,
  caller,
  chainId,
  onStageChange,
  ...disburse
}: DisburseEvmLoanParams): Promise<{ hash: Hex }> {
  const who = "disburseEvmLoan";
  const managerAddress = requireAddress(who, "accessManager", accessManager);
  const minterAddress = requireAddress(who, "minter", minter);
  requireAddress(who, "caller", caller);
  const calldata = encodeEvmDisburseCalldata(disburse);
  const { hash } = await sendEvmContractCallChecked(who, {
    abi: [...accessManagerAbi, ...evmDisburseErrorAbi],
    address: managerAddress,
    functionName: "execute",
    args: [minterAddress, calldata],
    value: 0n,
    account: caller,
    chainId,
    onStageChange,
  });
  return { hash };
}

function isMissingFunction(err: unknown): boolean {
  if (!(err instanceof BaseError)) return false;
  const zero = err.walk((e) => e instanceof ContractFunctionZeroDataError);
  if (zero) return true;
  const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
  if (!(reverted instanceof ContractFunctionRevertedError)) return false;
  return (
    reverted.data === undefined && (!reverted.raw || reverted.raw === "0x")
  );
}

function minterSlot(field: bigint): Hex {
  return toHex(BigInt(MINTER_STORAGE_SLOT) + field, { size: 32 });
}

function readMinterWord(minter: Address, slot: Hex): Promise<Hex> {
  return readEvmContract<Hex>({
    abi: minterExtsloadAbi,
    address: minter,
    functionName: "extsload",
    args: [slot],
  });
}

export async function readEvmMinterPaused({
  minter,
}: {
  minter: string;
}): Promise<boolean> {
  return readEvmContract<boolean>({
    abi: minterDisburseAbi,
    address: requireAddress("readEvmMinterPaused", "minter", minter),
    functionName: "paused",
  });
}

export async function readEvmMinterBankCash({
  minter,
}: {
  minter: string;
}): Promise<string> {
  const address = requireAddress("readEvmMinterBankCash", "minter", minter);
  try {
    const cash = await readEvmContract<bigint>({
      abi: minterDisburseAbi,
      address,
      functionName: "bankCash",
    });
    return cash.toString();
  } catch (err) {
    if (!isMissingFunction(err)) throw err;
  }
  const word = await readMinterWord(
    address,
    minterSlot(MINTER_BANK_CASH_FIELD),
  );
  return BigInt(word).toString();
}

export async function readEvmRefHashSeen({
  minter,
  refHash,
}: {
  minter: string;
  refHash: string;
}): Promise<boolean> {
  const who = "readEvmRefHashSeen";
  const address = requireAddress(who, "minter", minter);
  const hash = checkRefHash(who, refHash);
  try {
    return await readEvmContract<boolean>({
      abi: minterDisburseAbi,
      address,
      functionName: "refHashSeen",
      args: [hash],
    });
  } catch (err) {
    if (!isMissingFunction(err)) throw err;
  }
  const slot = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint256" }],
      [hash, BigInt(MINTER_STORAGE_SLOT) + MINTER_REF_HASHES_SEEN_FIELD],
    ),
  );
  return BigInt(await readMinterWord(address, slot)) !== 0n;
}
