import { describe, it, expect, vi, beforeEach } from "vitest";
import { StrKey, scValToNative } from "@stellar/stellar-sdk";

const { mockSimulateRead, mockRelay } = vi.hoisted(() => ({
  mockSimulateRead: vi.fn(),
  mockRelay: vi.fn(),
}));

vi.mock("./simulateRead", () => ({ simulateRead: mockSimulateRead }));
vi.mock("./accessManager", () => ({ relay: mockRelay }));

import { readDeal, registerDeal, registerDealArgs } from "./dealTokenFactory";

const FACTORY = StrKey.encodeContract(Buffer.alloc(32, 1));
const DEBT = StrKey.encodeContract(Buffer.alloc(32, 2));
const RPC = { rpcUrl: "https://rpc.test", networkPassphrase: "Test" };

beforeEach(() => {
  mockSimulateRead.mockReset();
  mockRelay.mockReset();
});

describe("readDeal", () => {
  it("reads deal(loan_id) with a u32 argument", async () => {
    mockSimulateRead.mockResolvedValue({ debt: DEBT });
    await readDeal({ factoryId: FACTORY, loanId: 7, ...RPC });
    const [contract, fn, args] = mockSimulateRead.mock.calls[0]!;
    expect(contract).toBe(FACTORY);
    expect(fn).toBe("deal");
    expect(args[0].switch().name).toBe("scvU32");
    expect(scValToNative(args[0])).toBe(7);
  });

  it("parses the debt-only and the legacy debt+cargo shapes", async () => {
    mockSimulateRead.mockResolvedValueOnce({ debt: DEBT });
    await expect(
      readDeal({ factoryId: FACTORY, loanId: 1, ...RPC }),
    ).resolves.toEqual({ debt: DEBT });
    mockSimulateRead.mockResolvedValueOnce({ debt: DEBT, cargo: DEBT });
    await expect(
      readDeal({ factoryId: FACTORY, loanId: 1, ...RPC }),
    ).resolves.toEqual({ debt: DEBT });
  });

  it("returns null only for Error(Contract, #4)", async () => {
    mockSimulateRead.mockRejectedValueOnce(
      new Error("deal simulation error: HostError: Error(Contract, #4)"),
    );
    await expect(
      readDeal({ factoryId: FACTORY, loanId: 1, ...RPC }),
    ).resolves.toBeNull();
    mockSimulateRead.mockRejectedValueOnce(
      new Error("deal simulation error: HostError: Error(Contract, #14)"),
    );
    await expect(
      readDeal({ factoryId: FACTORY, loanId: 1, ...RPC }),
    ).rejects.toThrow(/#14/);
    mockSimulateRead.mockRejectedValueOnce(new Error("network down"));
    await expect(
      readDeal({ factoryId: FACTORY, loanId: 1, ...RPC }),
    ).rejects.toThrow("network down");
  });

  it("throws when debt is missing or not a contract address", async () => {
    mockSimulateRead.mockResolvedValueOnce({ cargo: DEBT });
    await expect(
      readDeal({ factoryId: FACTORY, loanId: 1, ...RPC }),
    ).rejects.toThrow(/debt/);
    mockSimulateRead.mockResolvedValueOnce({ debt: "GABC" });
    await expect(
      readDeal({ factoryId: FACTORY, loanId: 1, ...RPC }),
    ).rejects.toThrow(/debt/);
  });

  it("rejects an empty factory id and an out-of-range loan id", async () => {
    await expect(
      readDeal({ factoryId: "", loanId: 1, ...RPC }),
    ).rejects.toThrow(/factoryId/);
    for (const loanId of [-1, 1.5, 2 ** 32]) {
      await expect(
        readDeal({ factoryId: FACTORY, loanId, ...RPC }),
      ).rejects.toThrow(/invalid loan id/);
    }
    expect(mockSimulateRead).not.toHaveBeenCalled();
  });
});

describe("registerDeal", () => {
  it("relays register_deal with a u32 loan id to the factory", async () => {
    mockRelay.mockResolvedValue({ hash: "h" });
    const signTransaction = vi.fn();
    const result = await registerDeal({
      mode: "execute",
      accessManagerId: "CAM",
      caller: "GCALLER",
      factoryId: FACTORY,
      loanId: 42,
      signTransaction,
      ...RPC,
    });
    expect(result).toEqual({ hash: "h" });
    const call = mockRelay.mock.calls[0]![0];
    expect(call.target).toBe(FACTORY);
    expect(call.fn).toBe("register_deal");
    expect(call.mode).toBe("execute");
    expect(call.accessManagerId).toBe("CAM");
    expect(call.args).toHaveLength(1);
    expect(call.args[0].switch().name).toBe("scvU32");
    expect(scValToNative(call.args[0])).toBe(42);
    expect(call.factoryId).toBeUndefined();
  });

  it("forwards the schedule mode", async () => {
    mockRelay.mockResolvedValue({ hash: "h" });
    await registerDeal({
      mode: "schedule",
      accessManagerId: "CAM",
      caller: "GCALLER",
      factoryId: FACTORY,
      loanId: 1,
      signTransaction: vi.fn(),
      ...RPC,
    });
    expect(mockRelay.mock.calls[0]![0].mode).toBe("schedule");
  });

  it("rejects an invalid loan id before relaying", () => {
    expect(() => registerDealArgs(-1)).toThrow(/invalid loan id/);
    expect(() =>
      registerDeal({
        mode: "execute",
        accessManagerId: "CAM",
        caller: "G",
        factoryId: FACTORY,
        loanId: 1.2,
        signTransaction: vi.fn(),
        ...RPC,
      }),
    ).toThrow(/invalid loan id/);
    expect(mockRelay).not.toHaveBeenCalled();
  });
});
