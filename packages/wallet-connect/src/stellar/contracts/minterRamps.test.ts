// spec: docs/frontend/trustee-flows.md#cash-management--conversions-and-bank-charges
import { describe, it, expect, vi, beforeEach } from "vitest";
import { StrKey, scValToNative } from "@stellar/stellar-sdk";

const { mockSimulateRead, mockRelay } = vi.hoisted(() => ({
  mockSimulateRead: vi.fn(),
  mockRelay: vi.fn(),
}));

vi.mock("./simulateRead", () => ({ simulateRead: mockSimulateRead }));
vi.mock("./accessManager", () => ({ relay: mockRelay }));

import {
  readMinterRamp,
  readMinterPoolState,
  readMinterPaused,
  encodeOpenRampArgs,
  encodeCloseRampArgs,
  encodeRecordExpenseArgs,
  openRamp,
  closeRamp,
  recordExpense,
} from "./minterRamps";

const MINTER = StrKey.encodeContract(Buffer.alloc(32, 1));
const RPC = { rpcUrl: "https://rpc.test", networkPassphrase: "Test" };
const HASH = "ab".repeat(32);
const ZERO = "0".repeat(64);

function chainRamp(overrides: Record<string, unknown> = {}) {
  return {
    amount: 12345670n,
    closed: false,
    closed_at: 0n,
    direction: ["BankToUsdc"],
    opened_at: 1_700_000_000n,
    received: 0n,
    ...overrides,
  };
}

beforeEach(() => {
  mockSimulateRead.mockReset();
  mockRelay.mockReset();
});

describe("readMinterRamp", () => {
  it("normalises the enum and bigints and accepts id 0", async () => {
    mockSimulateRead.mockResolvedValue(chainRamp());
    const ramp = await readMinterRamp({ minterId: MINTER, id: 0, ...RPC });
    expect(ramp).toEqual({
      id: 0,
      direction: "BankToUsdc",
      amount: "12345670",
      openedAt: 1_700_000_000,
      closed: false,
      closedAt: 0,
      received: "0",
    });
    expect(mockSimulateRead.mock.calls[0]![1]).toBe("ramp");
  });

  it("accepts the string direction form and a closed ramp", async () => {
    mockSimulateRead.mockResolvedValue(
      chainRamp({ direction: "UsdcToBank", closed: true, received: 5n }),
    );
    const ramp = await readMinterRamp({ minterId: MINTER, id: 3, ...RPC });
    expect(ramp.direction).toBe("UsdcToBank");
    expect(ramp.closed).toBe(true);
    expect(ramp.received).toBe("5");
  });

  it("throws on an unknown direction or a missing field", async () => {
    mockSimulateRead.mockResolvedValueOnce(chainRamp({ direction: ["Lost"] }));
    await expect(
      readMinterRamp({ minterId: MINTER, id: 1, ...RPC }),
    ).rejects.toThrow(/unknown direction/);
    mockSimulateRead.mockResolvedValueOnce(chainRamp({ amount: undefined }));
    await expect(
      readMinterRamp({ minterId: MINTER, id: 1, ...RPC }),
    ).rejects.toThrow(/amount missing/);
  });

  it("rejects an empty minter and a bad id before reading", async () => {
    await expect(
      readMinterRamp({ minterId: "", id: 1, ...RPC }),
    ).rejects.toThrow(/minterId/);
    await expect(
      readMinterRamp({ minterId: MINTER, id: -1, ...RPC }),
    ).rejects.toThrow(/invalid ramp id/);
    await expect(
      readMinterRamp({ minterId: MINTER, id: 0x1_0000_0000, ...RPC }),
    ).rejects.toThrow(/invalid ramp id/);
    expect(mockSimulateRead).not.toHaveBeenCalled();
  });
});

describe("readMinterPoolState / readMinterPaused", () => {
  it("maps the raw strings and read_failed, ignoring the rest", async () => {
    mockSimulateRead.mockResolvedValue({
      bank_cash: 7341220000000n,
      custody: [],
      in_flight: 10n,
      outstanding_total: 3n,
      read_failed: true,
      total_assets: 7341220000010n,
      unabsorbed_total: 0n,
    });
    expect(await readMinterPoolState({ minterId: MINTER, ...RPC })).toEqual({
      bankCash: "7341220000000",
      inFlight: "10",
      totalAssets: "7341220000010",
      readFailed: true,
    });
    expect(mockSimulateRead.mock.calls[0]![1]).toBe("pool_state");
  });

  it("throws on a missing pool field", async () => {
    mockSimulateRead.mockResolvedValue({ bank_cash: 1n });
    await expect(
      readMinterPoolState({ minterId: MINTER, ...RPC }),
    ).rejects.toThrow(/in_flight missing/);
  });

  it("reads paused as a strict boolean", async () => {
    mockSimulateRead.mockResolvedValueOnce(true);
    expect(await readMinterPaused({ minterId: MINTER, ...RPC })).toBe(true);
    mockSimulateRead.mockResolvedValueOnce(false);
    expect(await readMinterPaused({ minterId: MINTER, ...RPC })).toBe(false);
    expect(mockSimulateRead.mock.calls[0]![1]).toBe("paused");
  });
});

describe("encoders", () => {
  it("encodes the open direction as vec[symbol] with an exact i128", () => {
    for (const direction of ["UsdcToBank", "BankToUsdc"] as const) {
      const args = encodeOpenRampArgs({
        direction,
        amountRaw: "10000001",
        refHash: HASH,
      });
      expect(args.map((a) => a.switch().name)).toEqual([
        "scvVec",
        "scvI128",
        "scvBytes",
      ]);
      expect(args[0]!.vec()![0]!.switch().name).toBe("scvSymbol");
      expect(scValToNative(args[0]!)).toEqual([direction]);
      expect(scValToNative(args[1]!)).toBe(10000001n);
      expect(
        Buffer.from(scValToNative(args[2]!) as Uint8Array).toString("hex"),
      ).toBe(HASH);
    }
  });

  it("rejects bad open inputs", () => {
    const ok = {
      direction: "UsdcToBank" as const,
      amountRaw: "10",
      refHash: HASH,
    };
    expect(() => encodeOpenRampArgs({ ...ok, refHash: ZERO })).toThrow(
      /zero hash/,
    );
    expect(() => encodeOpenRampArgs({ ...ok, amountRaw: "0" })).toThrow(
      /amountRaw/,
    );
    expect(() => encodeOpenRampArgs({ ...ok, amountRaw: "-1" })).toThrow(
      /amountRaw/,
    );
    expect(() => encodeOpenRampArgs({ ...ok, amountRaw: "1.5" })).toThrow(
      /amountRaw/,
    );
    expect(() =>
      encodeOpenRampArgs({ ...ok, direction: "Sideways" as never }),
    ).toThrow(/unknown direction/);
  });

  it("encodes close args as u32, i128, bytes32 and allows id 0 and received 0", () => {
    const args = encodeCloseRampArgs({
      id: 0,
      receivedRaw: "0",
      refHash: HASH,
    });
    expect(args.map((a) => a.switch().name)).toEqual([
      "scvU32",
      "scvI128",
      "scvBytes",
    ]);
    expect(scValToNative(args[0]!)).toBe(0);
    expect(scValToNative(args[1]!)).toBe(0n);
  });

  it("rejects bad close inputs", () => {
    const ok = { id: 2, receivedRaw: "5", refHash: HASH };
    expect(() => encodeCloseRampArgs({ ...ok, refHash: ZERO })).toThrow(
      /zero hash/,
    );
    expect(() => encodeCloseRampArgs({ ...ok, receivedRaw: "-1" })).toThrow(
      /receivedRaw/,
    );
    expect(() => encodeCloseRampArgs({ ...ok, receivedRaw: "1.5" })).toThrow(
      /receivedRaw/,
    );
    expect(() => encodeCloseRampArgs({ ...ok, receivedRaw: "" })).toThrow(
      /receivedRaw/,
    );
    expect(() => encodeCloseRampArgs({ ...ok, id: -1 })).toThrow(
      /invalid ramp id/,
    );
    expect(() => encodeCloseRampArgs({ ...ok, id: 1.5 })).toThrow(
      /invalid ramp id/,
    );
    expect(() => encodeCloseRampArgs({ ...ok, id: 0x1_0000_0000 })).toThrow(
      /invalid ramp id/,
    );
  });

  it("encodes expense args as i128, u64, bytes32", () => {
    const args = encodeRecordExpenseArgs({
      deltaRaw: "10000001",
      valueDate: 1_700_000_000,
      refHash: HASH,
    });
    expect(args.map((a) => a.switch().name)).toEqual([
      "scvI128",
      "scvU64",
      "scvBytes",
    ]);
    expect(scValToNative(args[0]!)).toBe(10000001n);
    expect(scValToNative(args[1]!)).toBe(1_700_000_000n);
  });

  it("rejects bad expense inputs", () => {
    const ok = { deltaRaw: "10", valueDate: 1_700_000_000, refHash: HASH };
    expect(() => encodeRecordExpenseArgs({ ...ok, refHash: ZERO })).toThrow(
      /zero hash/,
    );
    expect(() => encodeRecordExpenseArgs({ ...ok, deltaRaw: "0" })).toThrow(
      /deltaRaw/,
    );
    expect(() => encodeRecordExpenseArgs({ ...ok, deltaRaw: "-3" })).toThrow(
      /deltaRaw/,
    );
    expect(() => encodeRecordExpenseArgs({ ...ok, deltaRaw: "1.5" })).toThrow(
      /deltaRaw/,
    );
    expect(() => encodeRecordExpenseArgs({ ...ok, valueDate: 0 })).toThrow(
      /valueDate/,
    );
    expect(() => encodeRecordExpenseArgs({ ...ok, valueDate: 1.5 })).toThrow(
      /valueDate/,
    );
  });
});

describe("openRamp / closeRamp / recordExpense", () => {
  const base = {
    minterId: MINTER,
    accessManagerId: "CDP7TUNB",
    caller: "GTRUSTEE",
    rpcUrl: RPC.rpcUrl,
    networkPassphrase: RPC.networkPassphrase,
    signTransaction: vi.fn(),
  };

  it("relays open_ramp in execute mode against the minter", async () => {
    mockRelay.mockResolvedValue({ hash: "h1" });
    const result = await openRamp({
      ...base,
      direction: "BankToUsdc",
      amountRaw: "10",
      refHash: HASH,
    });
    expect(result).toEqual({ hash: "h1" });
    const call = mockRelay.mock.calls[0]![0];
    expect(call.mode).toBe("execute");
    expect(call.target).toBe(MINTER);
    expect(call.fn).toBe("open_ramp");
    expect(call.caller).toBe("GTRUSTEE");
    expect(call.args).toHaveLength(3);
  });

  it("relays close_ramp in execute mode against the minter", async () => {
    mockRelay.mockResolvedValue({ hash: "h2" });
    await closeRamp({ ...base, id: 0, receivedRaw: "0", refHash: HASH });
    const call = mockRelay.mock.calls[0]![0];
    expect(call.mode).toBe("execute");
    expect(call.target).toBe(MINTER);
    expect(call.fn).toBe("close_ramp");
    expect(call.args).toHaveLength(3);
  });

  it("relays record_expense in execute mode against the minter", async () => {
    mockRelay.mockResolvedValue({ hash: "h3" });
    await recordExpense({
      ...base,
      deltaRaw: "10",
      valueDate: 1_700_000_000,
      refHash: HASH,
    });
    const call = mockRelay.mock.calls[0]![0];
    expect(call.mode).toBe("execute");
    expect(call.target).toBe(MINTER);
    expect(call.fn).toBe("record_expense");
    expect(call.args).toHaveLength(3);
  });
});
