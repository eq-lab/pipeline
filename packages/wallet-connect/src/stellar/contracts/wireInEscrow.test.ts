import { createHash } from "node:crypto";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Address, StrKey, scValToNative } from "@stellar/stellar-sdk";

const { mockSimulateRead, mockRelay } = vi.hoisted(() => ({
  mockSimulateRead: vi.fn(),
  mockRelay: vi.fn(),
}));

vi.mock("./simulateRead", () => ({ simulateRead: mockSimulateRead }));
vi.mock("./accessManager", () => ({ relay: mockRelay }));

import {
  readMinterWireIn,
  readMinterPlusdId,
  readPlusdAuthorization,
  readWireInRefHashSeen,
  wireInReturnRefHash,
  encodeAssignWireInArgs,
  encodeReturnWireInArgs,
  assignWireIn,
  returnWireIn,
} from "./wireInEscrow";

const MINTER = StrKey.encodeContract(Buffer.alloc(32, 1));
const PLUSD = StrKey.encodeContract(Buffer.alloc(32, 2));
const LP = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 3));
const RPC = { rpcUrl: "https://rpc.test", networkPassphrase: "Test" };
const HASH = "ab".repeat(32);

function chainWire(overrides: Record<string, unknown> = {}) {
  return {
    amount: 12345670n,
    receiver: MINTER,
    ref_hash: new Uint8Array(32).fill(0xab),
    return_ref: new Uint8Array(32),
    status: ["Escrowed"],
    value_date: 1_700_000_000n,
    ...overrides,
  };
}

beforeEach(() => {
  mockSimulateRead.mockReset();
  mockRelay.mockReset();
});

describe("readMinterWireIn", () => {
  it("normalises the enum, bytes and bigints", async () => {
    mockSimulateRead.mockResolvedValue(chainWire());
    const wire = await readMinterWireIn({ minterId: MINTER, id: 4, ...RPC });
    expect(wire).toEqual({
      id: 4,
      amount: "12345670",
      receiver: MINTER,
      refHash: HASH,
      returnRef: "0".repeat(64),
      status: "Escrowed",
      valueDate: 1_700_000_000,
    });
    expect(mockSimulateRead.mock.calls[0]![1]).toBe("wire_in");
  });

  it("throws on an unknown status", async () => {
    mockSimulateRead.mockResolvedValue(chainWire({ status: ["Lost"] }));
    await expect(
      readMinterWireIn({ minterId: MINTER, id: 4, ...RPC }),
    ).rejects.toThrow(/unknown status/);
  });

  it("throws on a missing field", async () => {
    mockSimulateRead.mockResolvedValue(chainWire({ amount: undefined }));
    await expect(
      readMinterWireIn({ minterId: MINTER, id: 4, ...RPC }),
    ).rejects.toThrow(/amount missing/);
  });

  it("rejects an empty minter and a bad id before reading", async () => {
    await expect(
      readMinterWireIn({ minterId: "", id: 4, ...RPC }),
    ).rejects.toThrow(/minterId/);
    await expect(
      readMinterWireIn({ minterId: MINTER, id: 0, ...RPC }),
    ).rejects.toThrow(/invalid wire id/);
    expect(mockSimulateRead).not.toHaveBeenCalled();
  });
});

describe("readMinterPlusdId", () => {
  it("returns addresses_config().plusd", async () => {
    mockSimulateRead.mockResolvedValue({ plusd: PLUSD });
    expect(await readMinterPlusdId({ minterId: MINTER, ...RPC })).toBe(PLUSD);
    expect(mockSimulateRead.mock.calls[0]![1]).toBe("addresses_config");
  });

  it("throws when plusd is missing", async () => {
    mockSimulateRead.mockResolvedValue({});
    await expect(
      readMinterPlusdId({ minterId: MINTER, ...RPC }),
    ).rejects.toThrow(/plusd missing/);
  });
});

describe("readPlusdAuthorization", () => {
  it("maps true and false", async () => {
    mockSimulateRead.mockResolvedValueOnce(true);
    expect(
      await readPlusdAuthorization({ plusdId: PLUSD, address: LP, ...RPC }),
    ).toBe("authorized");
    mockSimulateRead.mockResolvedValueOnce(false);
    expect(
      await readPlusdAuthorization({ plusdId: PLUSD, address: LP, ...RPC }),
    ).toBe("not-authorized");
    expect(mockSimulateRead.mock.calls[0]![1]).toBe("authorized");
  });

  it("maps the missing-trustline trap", async () => {
    mockSimulateRead.mockRejectedValue(
      new Error("authorized simulation error: Error(Contract, #13)"),
    );
    expect(
      await readPlusdAuthorization({ plusdId: PLUSD, address: LP, ...RPC }),
    ).toBe("no-trustline");
  });

  it("rethrows any other error", async () => {
    mockSimulateRead.mockRejectedValue(new Error("rpc down"));
    await expect(
      readPlusdAuthorization({ plusdId: PLUSD, address: LP, ...RPC }),
    ).rejects.toThrow("rpc down");
  });
});

describe("readWireInRefHashSeen", () => {
  it("reads ref_hash_seen", async () => {
    mockSimulateRead.mockResolvedValue(true);
    expect(
      await readWireInRefHashSeen({ minterId: MINTER, refHash: HASH, ...RPC }),
    ).toBe(true);
    expect(mockSimulateRead.mock.calls[0]![1]).toBe("ref_hash_seen");
  });
});

describe("wireInReturnRefHash", () => {
  it("hashes the trimmed reference", async () => {
    const expected = createHash("sha256").update("WIRE-OUT-9").digest("hex");
    expect(await wireInReturnRefHash("  WIRE-OUT-9 \n")).toBe(expected);
    expect(await wireInReturnRefHash("WIRE-OUT-9")).toBe(expected);
  });
});

describe("encoders", () => {
  it("orders assign args as u32, Address", () => {
    const args = encodeAssignWireInArgs({ id: 3, receiver: LP });
    expect(args).toHaveLength(2);
    expect(scValToNative(args[0]!)).toBe(3);
    expect(Address.fromScVal(args[1]!).toString()).toBe(LP);
  });

  it("orders return args as u32, BytesN<32>", () => {
    const args = encodeReturnWireInArgs({ id: 3, refHash: HASH });
    expect(scValToNative(args[0]!)).toBe(3);
    expect(
      Buffer.from(scValToNative(args[1]!) as Uint8Array).toString("hex"),
    ).toBe(HASH);
  });

  it("rejects a non-integer id, an id below 1 and the zero hash", () => {
    expect(() => encodeAssignWireInArgs({ id: 0, receiver: LP })).toThrow();
    expect(() => encodeAssignWireInArgs({ id: 1.5, receiver: LP })).toThrow();
    expect(() => encodeReturnWireInArgs({ id: -1, refHash: HASH })).toThrow();
    expect(() =>
      encodeReturnWireInArgs({ id: 1, refHash: "0".repeat(64) }),
    ).toThrow(/zero hash/);
  });
});

describe("assignWireIn / returnWireIn", () => {
  const base = {
    minterId: MINTER,
    accessManagerId: "CDP7TUNB",
    caller: "GTRUSTEE",
    rpcUrl: RPC.rpcUrl,
    networkPassphrase: RPC.networkPassphrase,
    signTransaction: vi.fn(),
  };

  it("relays assign_wire_in in execute mode against the minter", async () => {
    mockRelay.mockResolvedValue({ hash: "h1" });
    const result = await assignWireIn({ ...base, id: 2, receiver: LP });
    expect(result).toEqual({ hash: "h1" });
    const call = mockRelay.mock.calls[0]![0];
    expect(call.mode).toBe("execute");
    expect(call.target).toBe(MINTER);
    expect(call.fn).toBe("assign_wire_in");
    expect(call.caller).toBe("GTRUSTEE");
    expect(call.args).toHaveLength(2);
  });

  it("relays return_wire_in in execute mode against the minter", async () => {
    mockRelay.mockResolvedValue({ hash: "h2" });
    await returnWireIn({ ...base, id: 2, refHash: HASH });
    const call = mockRelay.mock.calls[0]![0];
    expect(call.mode).toBe("execute");
    expect(call.target).toBe(MINTER);
    expect(call.fn).toBe("return_wire_in");
    expect(call.args).toHaveLength(2);
  });
});
