// spec: docs/product-specs/loan-repayment-recovery.md
import {
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
} from "viem";
import type {
  OperationSchedule,
  RelayMode,
  RelayResult,
  RelayStage,
} from "../../stellar/contracts/accessManager";
import { sha256Hex } from "../../stellar/contracts/hash";
import type { RepaymentInput } from "../../stellar/contracts/loanRegistry";
import type { MinterRepayment } from "../../stellar/contracts/minter";
import { readEvmOperationSchedule, relayEvm } from "./accessManager";
import { loanIdTopic, scanEvmLogs } from "./logs";
import { evmRiskCouncilErrorAbi, readEvmMutableLoanData } from "./riskCouncil";
import { readEvmContract } from "./write";

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
}: {
  minter: string;
  loanId: number;
  repaymentId: number;
}): Promise<EvmMinterRepaymentRecord> {
  if (!minter)
    throw new Error("readEvmMinterRepayment: minter must not be empty");
  if (!isAddress(minter)) {
    throw new Error(`readEvmMinterRepayment: invalid minter ${minter}`);
  }
  const base = BigInt(evmMinterRepaymentSlot(loanId, repaymentId));
  const word = (offset: bigint) =>
    readEvmContract<Hex>({
      abi: minterExtsloadAbi,
      address: minter as Address,
      functionName: "extsload",
      args: [toHex(base + offset, { size: 32 })],
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
  const next = await readEvmNextRepaymentId({ registry, loanId });
  if (next === 0) return [];
  const logs = await scanEvmLogs({
    address: [registry as Address, minter as Address],
    topics: [[...EVM_RECOVERY_EVENT_TOPICS], loanIdTopic(loanId)],
    fromBlock,
    chainId,
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
