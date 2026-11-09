// spec: docs/product-specs/withdrawals.md#bank-wire-withdrawals-trustee-console
import { describe, it, expect, vi, beforeEach } from "vitest";
import { StrKey, scValToNative } from "@stellar/stellar-sdk";

const { mockSimulateRead, mockRelay } = vi.hoisted(() => ({
  mockSimulateRead: vi.fn(),
  mockRelay: vi.fn(),
}));

vi.mock("./simulateRead", () => ({ simulateRead: mockSimulateRead }));
vi.mock("./accessManager", () => ({ relay: mockRelay }));

import {
  readWireOutRecord,
  encodeSettleWireOutArgs,
  encodeCancelWireOutArgs,
  settleWireOut,
  cancelWireOut,
} from "./wireOutSettlement";

const MINTER = StrKey.encodeContract(Buffer.alloc(32, 1));
const LP = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 3));
const RPC = { rpcUrl: "https://rpc.test", networkPassphrase: "Test" };
const HASH = "ab".repeat(32);

function chainWireOut(overrides: Record<string, unknown> = {}) {
  return {
    amount: 12345670n,
    lp: LP,
    ref_hash: new Uint8Array(32).fill(0xab),
    requested_at: 1_700_000_000n,
    status: ["Pending"],
    ...overrides,
  };
}

beforeEach(() => {
  mockSimulateRead.mockReset();
  mockRelay.mockReset();
});

describe("readWireOutRecord", () => {
  it("normalises the enum, bytes and bigints", async () => {
    mockSimulateRead.mockResolvedValue(chainWireOut());
    const wire = await readWireOutRecord({ minterId: MINTER, id: 4, ...RPC });
    expect(wire).toEqual({
      id: 4,
      lp: LP,
      amount: "12345670",
      requestedAt: 1_700_000_000,
      status: "Pending",
      refHash: HASH,
    });
    expect(mockSimulateRead.mock.calls[0]![1]).toBe("wire_out");
  });

  it("accepts the string status form", async () => {
    mockSimulateRead.mockResolvedValue(chainWireOut({ status: "Settled" }));
    const wire = await readWireOutRecord({ minterId: MINTER, id: 4, ...RPC });
    expect(wire.status).toBe("Settled");
  });

  it("throws on an unknown status", async () => {
    mockSimulateRead.mockResolvedValue(chainWireOut({ status: ["Lost"] }));
    await expect(
      readWireOutRecord({ minterId: MINTER, id: 4, ...RPC }),
    ).rejects.toThrow(/unknown status/);
  });

  it("throws on a missing field or non-bytes hash", async () => {
    mockSimulateRead.mockResolvedValueOnce(chainWireOut({ amount: undefined }));
    await expect(
      readWireOutRecord({ minterId: MINTER, id: 4, ...RPC }),
    ).rejects.toThrow(/amount missing/);
    mockSimulateRead.mockResolvedValueOnce(chainWireOut({ ref_hash: "ab" }));
    await expect(
      readWireOutRecord({ minterId: MINTER, id: 4, ...RPC }),
    ).rejects.toThrow(/not bytes/);
  });

  it("rejects an empty minter and a bad id before reading", async () => {
    await expect(
      readWireOutRecord({ minterId: "", id: 4, ...RPC }),
    ).rejects.toThrow(/minterId/);
    await expect(
      readWireOutRecord({ minterId: MINTER, id: -1, ...RPC }),
    ).rejects.toThrow(/invalid wire id/);
    expect(mockSimulateRead).not.toHaveBeenCalled();
  });

  it("accepts id 0, the first minter id", async () => {
    mockSimulateRead.mockResolvedValue(chainWireOut());
    const wire = await readWireOutRecord({ minterId: MINTER, id: 0, ...RPC });
    expect(wire.id).toBe(0);
  });
});

describe("encoders", () => {
  it("orders settle args as u32, i128, u64, BytesN<32> with exact 7-dp amount", () => {
    const args = encodeSettleWireOutArgs({
      id: 3,
      amountRaw: "10000001",
      valueDate: 1_700_000_000,
      refHash: HASH,
    });
    expect(args).toHaveLength(4);
    expect(args.map((a) => a.switch().name)).toEqual([
      "scvU32",
      "scvI128",
      "scvU64",
      "scvBytes",
    ]);
    expect(scValToNative(args[0]!)).toBe(3);
    expect(scValToNative(args[1]!)).toBe(10000001n);
    expect(scValToNative(args[2]!)).toBe(1_700_000_000n);
    expect(
      Buffer.from(scValToNative(args[3]!) as Uint8Array).toString("hex"),
    ).toBe(HASH);
  });

  it("rejects bad settle inputs", () => {
    const ok = {
      id: 1,
      amountRaw: "10",
      valueDate: 1_700_000_000,
      refHash: HASH,
    };
    expect(() => encodeSettleWireOutArgs({ ...ok, id: -1 })).toThrow(
      /invalid wire id/,
    );
    expect(() =>
      encodeSettleWireOutArgs({ ...ok, refHash: "0".repeat(64) }),
    ).toThrow(/zero hash/);
    expect(() => encodeSettleWireOutArgs({ ...ok, valueDate: 0 })).toThrow(
      /valueDate/,
    );
    expect(() => encodeSettleWireOutArgs({ ...ok, valueDate: 1.5 })).toThrow(
      /valueDate/,
    );
    expect(() => encodeSettleWireOutArgs({ ...ok, amountRaw: "1.5" })).toThrow(
      /amountRaw/,
    );
    expect(() => encodeSettleWireOutArgs({ ...ok, amountRaw: "0" })).toThrow(
      /amountRaw/,
    );
    expect(() => encodeSettleWireOutArgs({ ...ok, amountRaw: "" })).toThrow(
      /amountRaw/,
    );
  });

  it("encodes cancel args as a single u32", () => {
    const args = encodeCancelWireOutArgs({ id: 7 });
    expect(args).toHaveLength(1);
    expect(scValToNative(args[0]!)).toBe(7);
    expect(() => encodeCancelWireOutArgs({ id: -1 })).toThrow();
    expect(() => encodeCancelWireOutArgs({ id: 1.5 })).toThrow();
    expect(scValToNative(encodeCancelWireOutArgs({ id: 0 })[0]!)).toBe(0);
  });
});

describe("settleWireOut / cancelWireOut", () => {
  const base = {
    minterId: MINTER,
    accessManagerId: "CDP7TUNB",
    caller: "GTRUSTEE",
    rpcUrl: RPC.rpcUrl,
    networkPassphrase: RPC.networkPassphrase,
    signTransaction: vi.fn(),
  };

  it("relays settle_wire_out in execute mode against the minter", async () => {
    mockRelay.mockResolvedValue({ hash: "h1" });
    const result = await settleWireOut({
      ...base,
      id: 2,
      amountRaw: "10",
      valueDate: 1_700_000_000,
      refHash: HASH,
    });
    expect(result).toEqual({ hash: "h1" });
    const call = mockRelay.mock.calls[0]![0];
    expect(call.mode).toBe("execute");
    expect(call.target).toBe(MINTER);
    expect(call.fn).toBe("settle_wire_out");
    expect(call.caller).toBe("GTRUSTEE");
    expect(call.args).toHaveLength(4);
  });

  it("relays cancel_wire_out in execute mode against the minter", async () => {
    mockRelay.mockResolvedValue({ hash: "h2" });
    await cancelWireOut({ ...base, id: 2 });
    const call = mockRelay.mock.calls[0]![0];
    expect(call.mode).toBe("execute");
    expect(call.target).toBe(MINTER);
    expect(call.fn).toBe("cancel_wire_out");
    expect(call.args).toHaveLength(1);
  });
});
