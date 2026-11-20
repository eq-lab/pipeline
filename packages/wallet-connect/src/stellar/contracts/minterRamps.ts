// spec: docs/frontend/trustee-flows.md#cash-management--conversions-and-bank-charges
import { nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { hexToBytes32ScVal } from "./minter";
import { relay, type RelayParams, type RelayResult } from "./accessManager";
import { simulateRead, type SimulateReadOptions } from "./simulateRead";

export type RampDirection = "UsdcToBank" | "BankToUsdc";

export interface MinterRamp {
  id: number;
  direction: RampDirection;
  amount: string;
  openedAt: number;
  closed: boolean;
  closedAt: number;
  received: string;
}

export interface MinterPoolState {
  bankCash: string;
  inFlight: string;
  totalAssets: string;
  readFailed: boolean;
}

const RAMP_DIRECTIONS: readonly string[] = ["UsdcToBank", "BankToUsdc"];
const ZERO_REF_HASH = "0".repeat(64);
const OPEN_RAMP_FN = "open_ramp";
const CLOSE_RAMP_FN = "close_ramp";
const RECORD_EXPENSE_FN = "record_expense";
const MAX_U32 = 0xffffffff;

function requireRampId(id: number, who: string): void {
  if (!Number.isInteger(id) || id < 0 || id > MAX_U32) {
    throw new Error(`${who}: invalid ramp id ${id}`);
  }
}

function requireRefHash(refHash: string, who: string): void {
  if (refHash === ZERO_REF_HASH) {
    throw new Error(`${who}: refHash must not be the zero hash`);
  }
}

function requirePositiveRaw(raw: string, name: string, who: string): void {
  if (!/^\d+$/.test(raw) || BigInt(raw) <= 0n) {
    throw new Error(
      `${who}: ${name} must be a positive integer string, got "${raw}"`,
    );
  }
}

function rampDirection(raw: unknown, who: string): RampDirection {
  const name = Array.isArray(raw) ? raw[0] : raw;
  if (typeof name !== "string" || !RAMP_DIRECTIONS.includes(name)) {
    throw new Error(`${who}: unknown direction ${JSON.stringify(name)}`);
  }
  return name as RampDirection;
}

export interface ReadMinterRampParams extends SimulateReadOptions {
  minterId: string;
  id: number;
}

export async function readMinterRamp({
  minterId,
  id,
  rpcUrl,
  networkPassphrase,
}: ReadMinterRampParams): Promise<MinterRamp> {
  if (!minterId) throw new Error("readMinterRamp: minterId must not be empty");
  requireRampId(id, "readMinterRamp");
  const data = (await simulateRead(
    minterId,
    "ramp",
    [nativeToScVal(id, { type: "u32" })],
    { rpcUrl, networkPassphrase },
  )) as Record<string, unknown> | null;
  const field = (key: string): unknown => {
    const raw = data?.[key];
    if (raw === undefined || raw === null) {
      throw new Error(`readMinterRamp: ${key} missing`);
    }
    return raw;
  };
  return {
    id,
    direction: rampDirection(field("direction"), "readMinterRamp"),
    amount: String(field("amount")),
    openedAt: Number(field("opened_at")),
    closed: field("closed") === true,
    closedAt: Number(field("closed_at")),
    received: String(field("received")),
  };
}

export interface ReadMinterPoolStateParams extends SimulateReadOptions {
  minterId: string;
}

export async function readMinterPoolState({
  minterId,
  rpcUrl,
  networkPassphrase,
}: ReadMinterPoolStateParams): Promise<MinterPoolState> {
  if (!minterId) {
    throw new Error("readMinterPoolState: minterId must not be empty");
  }
  const data = (await simulateRead(minterId, "pool_state", [], {
    rpcUrl,
    networkPassphrase,
  })) as Record<string, unknown> | null;
  const field = (key: string): unknown => {
    const raw = data?.[key];
    if (raw === undefined || raw === null) {
      throw new Error(`readMinterPoolState: ${key} missing`);
    }
    return raw;
  };
  return {
    bankCash: String(field("bank_cash")),
    inFlight: String(field("in_flight")),
    totalAssets: String(field("total_assets")),
    readFailed: field("read_failed") === true,
  };
}

export async function readMinterPaused({
  minterId,
  rpcUrl,
  networkPassphrase,
}: ReadMinterPoolStateParams): Promise<boolean> {
  if (!minterId)
    throw new Error("readMinterPaused: minterId must not be empty");
  const paused = await simulateRead(minterId, "paused", [], {
    rpcUrl,
    networkPassphrase,
  });
  return paused === true;
}

export interface OpenRampArgs {
  direction: RampDirection;
  amountRaw: string;
  refHash: string;
}

export interface CloseRampArgs {
  id: number;
  receivedRaw: string;
  refHash: string;
}

export interface RecordExpenseArgs {
  deltaRaw: string;
  valueDate: number;
  refHash: string;
}

export function encodeOpenRampArgs({
  direction,
  amountRaw,
  refHash,
}: OpenRampArgs): xdr.ScVal[] {
  const who = "encodeOpenRampArgs";
  if (!RAMP_DIRECTIONS.includes(direction)) {
    throw new Error(`${who}: unknown direction ${JSON.stringify(direction)}`);
  }
  requirePositiveRaw(amountRaw, "amountRaw", who);
  requireRefHash(refHash, who);
  return [
    xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(direction)]),
    nativeToScVal(BigInt(amountRaw), { type: "i128" }),
    hexToBytes32ScVal(refHash),
  ];
}

export function encodeCloseRampArgs({
  id,
  receivedRaw,
  refHash,
}: CloseRampArgs): xdr.ScVal[] {
  const who = "encodeCloseRampArgs";
  requireRampId(id, who);
  if (!/^\d+$/.test(receivedRaw)) {
    throw new Error(
      `${who}: receivedRaw must be a non-negative integer string, got "${receivedRaw}"`,
    );
  }
  requireRefHash(refHash, who);
  return [
    nativeToScVal(id, { type: "u32" }),
    nativeToScVal(BigInt(receivedRaw), { type: "i128" }),
    hexToBytes32ScVal(refHash),
  ];
}

export function encodeRecordExpenseArgs({
  deltaRaw,
  valueDate,
  refHash,
}: RecordExpenseArgs): xdr.ScVal[] {
  const who = "encodeRecordExpenseArgs";
  requirePositiveRaw(deltaRaw, "deltaRaw", who);
  if (!Number.isInteger(valueDate) || valueDate <= 0) {
    throw new Error(
      `${who}: valueDate must be a positive Unix-seconds integer, got ${valueDate}`,
    );
  }
  requireRefHash(refHash, who);
  return [
    nativeToScVal(BigInt(deltaRaw), { type: "i128" }),
    nativeToScVal(BigInt(valueDate), { type: "u64" }),
    hexToBytes32ScVal(refHash),
  ];
}

type RampRelayParams = Omit<RelayParams, "mode" | "target" | "fn" | "args"> & {
  minterId: string;
};

export type OpenRampParams = RampRelayParams & OpenRampArgs;
export type CloseRampParams = RampRelayParams & CloseRampArgs;
export type RecordExpenseParams = RampRelayParams & RecordExpenseArgs;

export function openRamp({
  minterId,
  direction,
  amountRaw,
  refHash,
  ...rest
}: OpenRampParams): Promise<RelayResult> {
  return relay({
    ...rest,
    mode: "execute",
    target: minterId,
    fn: OPEN_RAMP_FN,
    args: encodeOpenRampArgs({ direction, amountRaw, refHash }),
  });
}

export function closeRamp({
  minterId,
  id,
  receivedRaw,
  refHash,
  ...rest
}: CloseRampParams): Promise<RelayResult> {
  return relay({
    ...rest,
    mode: "execute",
    target: minterId,
    fn: CLOSE_RAMP_FN,
    args: encodeCloseRampArgs({ id, receivedRaw, refHash }),
  });
}

export function recordExpense({
  minterId,
  deltaRaw,
  valueDate,
  refHash,
  ...rest
}: RecordExpenseParams): Promise<RelayResult> {
  return relay({
    ...rest,
    mode: "execute",
    target: minterId,
    fn: RECORD_EXPENSE_FN,
    args: encodeRecordExpenseArgs({ deltaRaw, valueDate, refHash }),
  });
}
