// spec: docs/product-specs/withdrawals.md#bank-wire-withdrawals-trustee-console
import { nativeToScVal, type xdr } from "@stellar/stellar-sdk";
import { hexToBytes32ScVal } from "./minter";
import { relay, type RelayParams, type RelayResult } from "./accessManager";
import { simulateRead, type SimulateReadOptions } from "./simulateRead";

export type WireOutRecordStatus = "Pending" | "Settled" | "Cancelled";

export interface WireOutRecord {
  id: number;
  lp: string;
  amount: string;
  requestedAt: number;
  status: WireOutRecordStatus;
  refHash: string;
}

const WIRE_OUT_STATUSES: readonly string[] = [
  "Pending",
  "Settled",
  "Cancelled",
];
const ZERO_REF_HASH = "0".repeat(64);
const SETTLE_WIRE_OUT_FN = "settle_wire_out";
const CANCEL_WIRE_OUT_FN = "cancel_wire_out";

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function requireWireId(id: number, who: string): void {
  if (!Number.isInteger(id) || id < 1) {
    throw new Error(`${who}: invalid wire id ${id}`);
  }
}

function wireOutStatus(raw: unknown): WireOutRecordStatus {
  const name = Array.isArray(raw) ? raw[0] : raw;
  if (typeof name !== "string" || !WIRE_OUT_STATUSES.includes(name)) {
    throw new Error(
      `readWireOutRecord: unknown status ${JSON.stringify(name)}`,
    );
  }
  return name as WireOutRecordStatus;
}

export interface ReadWireOutRecordParams extends SimulateReadOptions {
  minterId: string;
  id: number;
}

export async function readWireOutRecord({
  minterId,
  id,
  rpcUrl,
  networkPassphrase,
}: ReadWireOutRecordParams): Promise<WireOutRecord> {
  if (!minterId)
    throw new Error("readWireOutRecord: minterId must not be empty");
  requireWireId(id, "readWireOutRecord");
  const data = (await simulateRead(
    minterId,
    "wire_out",
    [nativeToScVal(id, { type: "u32" })],
    { rpcUrl, networkPassphrase },
  )) as Record<string, unknown> | null;
  const field = (key: string): unknown => {
    const raw = data?.[key];
    if (raw === undefined || raw === null) {
      throw new Error(`readWireOutRecord: ${key} missing`);
    }
    return raw;
  };
  const refHash = field("ref_hash");
  if (!(refHash instanceof Uint8Array)) {
    throw new Error("readWireOutRecord: ref_hash is not bytes");
  }
  return {
    id,
    lp: String(field("lp")),
    amount: String(field("amount")),
    requestedAt: Number(field("requested_at")),
    status: wireOutStatus(field("status")),
    refHash: toHex(refHash),
  };
}

export interface SettleWireOutArgs {
  id: number;
  amountRaw: string;
  valueDate: number;
  refHash: string;
}

export interface CancelWireOutArgs {
  id: number;
}

export function encodeSettleWireOutArgs({
  id,
  amountRaw,
  valueDate,
  refHash,
}: SettleWireOutArgs): xdr.ScVal[] {
  requireWireId(id, "encodeSettleWireOutArgs");
  if (!/^\d+$/.test(amountRaw) || BigInt(amountRaw) <= 0n) {
    throw new Error(
      `encodeSettleWireOutArgs: amountRaw must be a positive integer string, got "${amountRaw}"`,
    );
  }
  if (!Number.isInteger(valueDate) || valueDate <= 0) {
    throw new Error(
      `encodeSettleWireOutArgs: valueDate must be a positive Unix-seconds integer, got ${valueDate}`,
    );
  }
  if (refHash === ZERO_REF_HASH) {
    throw new Error(
      "encodeSettleWireOutArgs: refHash must not be the zero hash",
    );
  }
  return [
    nativeToScVal(id, { type: "u32" }),
    nativeToScVal(BigInt(amountRaw), { type: "i128" }),
    nativeToScVal(BigInt(valueDate), { type: "u64" }),
    hexToBytes32ScVal(refHash),
  ];
}

export function encodeCancelWireOutArgs({
  id,
}: CancelWireOutArgs): xdr.ScVal[] {
  requireWireId(id, "encodeCancelWireOutArgs");
  return [nativeToScVal(id, { type: "u32" })];
}

type WireOutRelayParams = Omit<
  RelayParams,
  "mode" | "target" | "fn" | "args"
> & {
  minterId: string;
};

export type SettleWireOutParams = WireOutRelayParams & SettleWireOutArgs;
export type CancelWireOutParams = WireOutRelayParams & CancelWireOutArgs;

export function settleWireOut({
  minterId,
  id,
  amountRaw,
  valueDate,
  refHash,
  ...rest
}: SettleWireOutParams): Promise<RelayResult> {
  return relay({
    ...rest,
    mode: "execute",
    target: minterId,
    fn: SETTLE_WIRE_OUT_FN,
    args: encodeSettleWireOutArgs({ id, amountRaw, valueDate, refHash }),
  });
}

export function cancelWireOut({
  minterId,
  id,
  ...rest
}: CancelWireOutParams): Promise<RelayResult> {
  return relay({
    ...rest,
    mode: "execute",
    target: minterId,
    fn: CANCEL_WIRE_OUT_FN,
    args: encodeCancelWireOutArgs({ id }),
  });
}
