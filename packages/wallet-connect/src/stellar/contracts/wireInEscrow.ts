// spec: docs/product-specs/deposits.md#escrowed-wires
import { Address, nativeToScVal, type xdr } from "@stellar/stellar-sdk";
import { hexToBytes32ScVal } from "./minter";
import { relay, type RelayParams, type RelayResult } from "./accessManager";
import { simulateRead, type SimulateReadOptions } from "./simulateRead";

export type WireInStatus = "Direct" | "Escrowed" | "Assigned" | "Returned";

export interface MinterWireIn {
  id: number;
  amount: string;
  receiver: string;
  refHash: string;
  returnRef: string;
  status: WireInStatus;
  valueDate: number;
}

export type PlusdAuthorization =
  | "authorized"
  | "not-authorized"
  | "no-trustline";

const WIRE_IN_STATUSES: readonly string[] = [
  "Direct",
  "Escrowed",
  "Assigned",
  "Returned",
];
const ZERO_REF_HASH = "0".repeat(64);
const ASSIGN_WIRE_IN_FN = "assign_wire_in";
const RETURN_WIRE_IN_FN = "return_wire_in";

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function requireWireId(id: number, who: string): void {
  if (!Number.isInteger(id) || id < 1) {
    throw new Error(`${who}: invalid wire id ${id}`);
  }
}

function wireInStatus(raw: unknown): WireInStatus {
  const name = Array.isArray(raw) ? raw[0] : raw;
  if (typeof name !== "string" || !WIRE_IN_STATUSES.includes(name)) {
    throw new Error(`readMinterWireIn: unknown status ${JSON.stringify(name)}`);
  }
  return name as WireInStatus;
}

export interface ReadMinterWireInParams extends SimulateReadOptions {
  minterId: string;
  id: number;
}

export async function readMinterWireIn({
  minterId,
  id,
  rpcUrl,
  networkPassphrase,
}: ReadMinterWireInParams): Promise<MinterWireIn> {
  if (!minterId)
    throw new Error("readMinterWireIn: minterId must not be empty");
  requireWireId(id, "readMinterWireIn");
  const data = (await simulateRead(
    minterId,
    "wire_in",
    [nativeToScVal(id, { type: "u32" })],
    { rpcUrl, networkPassphrase },
  )) as Record<string, unknown> | null;
  const field = (key: string): unknown => {
    const raw = data?.[key];
    if (raw === undefined || raw === null) {
      throw new Error(`readMinterWireIn: ${key} missing`);
    }
    return raw;
  };
  const bytes = (key: string): string => {
    const raw = field(key);
    if (!(raw instanceof Uint8Array)) {
      throw new Error(`readMinterWireIn: ${key} is not bytes`);
    }
    return toHex(raw);
  };
  return {
    id,
    amount: String(field("amount")),
    receiver: String(field("receiver")),
    refHash: bytes("ref_hash"),
    returnRef: bytes("return_ref"),
    status: wireInStatus(field("status")),
    valueDate: Number(field("value_date")),
  };
}

export interface ReadMinterPlusdIdParams extends SimulateReadOptions {
  minterId: string;
}

export async function readMinterPlusdId({
  minterId,
  rpcUrl,
  networkPassphrase,
}: ReadMinterPlusdIdParams): Promise<string> {
  if (!minterId)
    throw new Error("readMinterPlusdId: minterId must not be empty");
  const data = (await simulateRead(minterId, "addresses_config", [], {
    rpcUrl,
    networkPassphrase,
  })) as { plusd?: unknown } | null;
  if (typeof data?.plusd !== "string" || data.plusd === "") {
    throw new Error("readMinterPlusdId: plusd missing");
  }
  return data.plusd;
}

export interface ReadPlusdAuthorizationParams extends SimulateReadOptions {
  plusdId: string;
  address: string;
}

export async function readPlusdAuthorization({
  plusdId,
  address,
  rpcUrl,
  networkPassphrase,
}: ReadPlusdAuthorizationParams): Promise<PlusdAuthorization> {
  if (!plusdId)
    throw new Error("readPlusdAuthorization: plusdId must not be empty");
  try {
    const authorized = await simulateRead(
      plusdId,
      "authorized",
      [new Address(address).toScVal()],
      { rpcUrl, networkPassphrase },
    );
    return authorized === true ? "authorized" : "not-authorized";
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (/Error\(Contract,\s*#13\)/.test(text)) return "no-trustline";
    throw error;
  }
}

export interface ReadWireInRefHashSeenParams extends SimulateReadOptions {
  minterId: string;
  refHash: string;
}

export async function readWireInRefHashSeen({
  minterId,
  refHash,
  rpcUrl,
  networkPassphrase,
}: ReadWireInRefHashSeenParams): Promise<boolean> {
  if (!minterId) {
    throw new Error("readWireInRefHashSeen: minterId must not be empty");
  }
  const seen = await simulateRead(
    minterId,
    "ref_hash_seen",
    [hexToBytes32ScVal(refHash)],
    { rpcUrl, networkPassphrase },
  );
  return seen === true;
}

export async function wireInReturnRefHash(reference: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(reference.trim()),
  );
  return toHex(new Uint8Array(digest));
}

export interface AssignWireInArgs {
  id: number;
  receiver: string;
}

export interface ReturnWireInArgs {
  id: number;
  refHash: string;
}

export function encodeAssignWireInArgs({
  id,
  receiver,
}: AssignWireInArgs): xdr.ScVal[] {
  requireWireId(id, "encodeAssignWireInArgs");
  return [nativeToScVal(id, { type: "u32" }), new Address(receiver).toScVal()];
}

export function encodeReturnWireInArgs({
  id,
  refHash,
}: ReturnWireInArgs): xdr.ScVal[] {
  requireWireId(id, "encodeReturnWireInArgs");
  if (refHash === ZERO_REF_HASH) {
    throw new Error(
      "encodeReturnWireInArgs: refHash must not be the zero hash",
    );
  }
  return [nativeToScVal(id, { type: "u32" }), hexToBytes32ScVal(refHash)];
}

type EscrowRelayParams = Omit<
  RelayParams,
  "mode" | "target" | "fn" | "args"
> & {
  minterId: string;
};

export type AssignWireInParams = EscrowRelayParams & AssignWireInArgs;
export type ReturnWireInParams = EscrowRelayParams & ReturnWireInArgs;

export function assignWireIn({
  minterId,
  id,
  receiver,
  ...rest
}: AssignWireInParams): Promise<RelayResult> {
  return relay({
    ...rest,
    mode: "execute",
    target: minterId,
    fn: ASSIGN_WIRE_IN_FN,
    args: encodeAssignWireInArgs({ id, receiver }),
  });
}

export function returnWireIn({
  minterId,
  id,
  refHash,
  ...rest
}: ReturnWireInParams): Promise<RelayResult> {
  return relay({
    ...rest,
    mode: "execute",
    target: minterId,
    fn: RETURN_WIRE_IN_FN,
    args: encodeReturnWireInArgs({ id, refHash }),
  });
}
