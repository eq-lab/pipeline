// spec: docs/frontend/trustee-flows.md#disburse-1898
import { describe, it, expect, vi, beforeEach } from "vitest";
import { StrKey, scValToNative } from "@stellar/stellar-sdk";

const { mockSimulateRead, mockRelay } = vi.hoisted(() => ({
  mockSimulateRead: vi.fn(),
  mockRelay: vi.fn(),
}));

vi.mock("./simulateRead", () => ({ simulateRead: mockSimulateRead }));
vi.mock("./accessManager", () => ({ relay: mockRelay }));

import { disburse, encodeDisburseArgs } from "./minter";
import { readLoanDisbursementState, readLoanOwner } from "./loanRegistry";
import { readDebtTrustline } from "./dealTokenFactory";

const MINTER = StrKey.encodeContract(Buffer.alloc(32, 1));
const REGISTRY = StrKey.encodeContract(Buffer.alloc(32, 2));
const DEBT = StrKey.encodeContract(Buffer.alloc(32, 3));
const HOLDER = StrKey.encodeContract(Buffer.alloc(32, 4));
const HASH = "ab".repeat(32);
const RPC = { rpcUrl: "https://rpc.test", networkPassphrase: "Test" };

beforeEach(() => {
  mockSimulateRead.mockReset();
  mockRelay.mockReset();
});

describe("encodeDisburseArgs", () => {
  const ok = {
    loanId: 3,
    amountRaw: "500000000000",
    valueDate: 1_700_000_000,
    refHash: HASH,
  };

  it("orders args as u32, i128, u64, BytesN<32>", () => {
    const args = encodeDisburseArgs(ok);
    expect(args.map((a) => a.switch().name)).toEqual([
      "scvU32",
      "scvI128",
      "scvU64",
      "scvBytes",
    ]);
    expect(scValToNative(args[0]!)).toBe(3);
    expect(scValToNative(args[1]!)).toBe(500000000000n);
    expect(scValToNative(args[2]!)).toBe(1_700_000_000n);
  });

  it("rejects bad inputs", () => {
    expect(() => encodeDisburseArgs({ ...ok, loanId: -1 })).toThrow(
      /encodeDisburseArgs/,
    );
    expect(() => encodeDisburseArgs({ ...ok, loanId: 1.5 })).toThrow();
    for (const amountRaw of ["0", "-1", "1.5", ""]) {
      expect(() => encodeDisburseArgs({ ...ok, amountRaw })).toThrow();
    }
    expect(() => encodeDisburseArgs({ ...ok, valueDate: 0 })).toThrow();
    expect(() => encodeDisburseArgs({ ...ok, valueDate: 1.5 })).toThrow();
    expect(() =>
      encodeDisburseArgs({ ...ok, refHash: "0".repeat(64) }),
    ).toThrow(/zero hash/);
  });
});

describe("disburse", () => {
  it("relays disburse in execute mode against the minter", async () => {
    mockRelay.mockResolvedValue({ hash: "h1" });
    const result = await disburse({
      minterId: MINTER,
      accessManagerId: "CAM",
      caller: "GTRUSTEE",
      ...RPC,
      signTransaction: vi.fn(),
      loanId: 0,
      amountRaw: "10",
      valueDate: 1_700_000_000,
      refHash: HASH,
    });
    expect(result).toEqual({ hash: "h1" });
    const call = mockRelay.mock.calls[0]![0];
    expect(call.mode).toBe("execute");
    expect(call.target).toBe(MINTER);
    expect(call.fn).toBe("disburse");
    expect(call.caller).toBe("GTRUSTEE");
    expect(call.args).toHaveLength(4);
  });
});

describe("readLoanDisbursementState", () => {
  it("maps status, carved_out and raw amounts", async () => {
    mockSimulateRead.mockImplementation(async (_id: string, fn: string) =>
      fn === "mutable_loan_data"
        ? { status: ["Approved"], carved_out: false, disbursed: 0n }
        : { original_senior_tranche: 500000000000n },
    );
    await expect(
      readLoanDisbursementState({ registryId: REGISTRY, loanId: 0, ...RPC }),
    ).resolves.toEqual({
      status: "Approved",
      carvedOut: false,
      disbursed: "0",
      originalSeniorTranche: "500000000000",
    });
  });

  it("throws on a missing field", async () => {
    mockSimulateRead.mockImplementation(async (_id: string, fn: string) =>
      fn === "mutable_loan_data"
        ? { status: ["Approved"], carved_out: false }
        : { original_senior_tranche: 1n },
    );
    await expect(
      readLoanDisbursementState({ registryId: REGISTRY, loanId: 0, ...RPC }),
    ).rejects.toThrow("readLoanDisbursementState: disbursed missing");
  });
});

describe("readLoanOwner", () => {
  it("returns the strkey and rejects garbage", async () => {
    mockSimulateRead.mockResolvedValueOnce(HOLDER);
    await expect(
      readLoanOwner({ registryId: REGISTRY, loanId: 0, ...RPC }),
    ).resolves.toBe(HOLDER);
    mockSimulateRead.mockResolvedValueOnce("nope");
    await expect(
      readLoanOwner({ registryId: REGISTRY, loanId: 0, ...RPC }),
    ).rejects.toThrow("readLoanOwner");
  });
});

describe("readDebtTrustline", () => {
  const params = { debtId: DEBT, holder: HOLDER, ...RPC };

  it("maps true and false to present", async () => {
    mockSimulateRead.mockResolvedValueOnce(true);
    await expect(readDebtTrustline(params)).resolves.toBe("present");
    mockSimulateRead.mockResolvedValueOnce(false);
    await expect(readDebtTrustline(params)).resolves.toBe("present");
  });

  it("maps Error(Contract, #13) to missing and rethrows others", async () => {
    mockSimulateRead.mockRejectedValueOnce(
      new Error("authorized simulation error: Error(Contract, #13)"),
    );
    await expect(readDebtTrustline(params)).resolves.toBe("missing");
    mockSimulateRead.mockRejectedValueOnce(new Error("rpc down"));
    await expect(readDebtTrustline(params)).rejects.toThrow("rpc down");
  });
});
