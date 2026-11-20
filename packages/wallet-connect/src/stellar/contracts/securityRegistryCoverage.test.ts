// spec: docs/frontend/trustee-flows.md#security-marks-1859
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  call: vi.fn().mockReturnValue("op"),
  getAccount: vi.fn().mockResolvedValue("account"),
  simulate: vi.fn().mockResolvedValue({}),
  send: vi.fn().mockResolvedValue({ status: "PENDING", hash: "tx-hash" }),
  poll: vi.fn().mockResolvedValue({ status: "SUCCESS" }),
  isSimError: vi.fn().mockReturnValue(false),
}));

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();
  class MockContract {
    call(method: string, ...args: unknown[]) {
      return m.call(method, ...args);
    }
  }
  class MockServer {
    getAccount = m.getAccount;
    simulateTransaction = m.simulate;
    sendTransaction = m.send;
    pollTransaction = m.poll;
  }
  class MockTransactionBuilder {
    addOperation() {
      return {
        setTimeout: () => ({ build: () => ({ built: true }) }),
      };
    }
    static fromXDR() {
      return "signed-tx";
    }
  }
  return {
    ...actual,
    Contract: MockContract,
    TransactionBuilder: MockTransactionBuilder,
    rpc: {
      ...actual.rpc,
      Server: MockServer,
      Api: {
        isSimulationError: m.isSimError,
        GetTransactionStatus: { SUCCESS: "SUCCESS" },
      },
      assembleTransaction: () => ({
        build: () => ({ toXDR: () => "env-xdr" }),
      }),
    },
  };
});

import { StrKey, xdr } from "@stellar/stellar-sdk";
import {
  approveInspection,
  buildCheckCoverageEnvelope,
  checkCoverage,
  recordInspection,
} from "./securityRegistry";

const params = {
  registryId: "CSEC",
  loanId: 12,
  caller: "GCALLER",
  rpcUrl: "https://rpc.test",
  networkPassphrase: "Test SDF Network ; September 2015",
};

beforeEach(() => {
  vi.clearAllMocks();
  m.isSimError.mockReturnValue(false);
  m.send.mockResolvedValue({ status: "PENDING", hash: "tx-hash" });
  m.poll.mockResolvedValue({ status: "SUCCESS" });
});

describe("buildCheckCoverageEnvelope", () => {
  it("calls check_coverage with the u32 loan id directly on the registry", async () => {
    await expect(buildCheckCoverageEnvelope(params)).resolves.toBe("env-xdr");
    const [method, ...args] = m.call.mock.calls[0]!;
    expect(method).toBe("check_coverage");
    expect(args).toHaveLength(1);
    expect(args[0].switch().name).toBe("scvU32");
    expect(m.getAccount).toHaveBeenCalledWith("GCALLER");
  });

  it("rejects an invalid loan id and surfaces simulation errors", async () => {
    await expect(
      buildCheckCoverageEnvelope({ ...params, loanId: -1 }),
    ).rejects.toThrow(/loanId/);
    m.isSimError.mockReturnValue(true);
    m.simulate.mockResolvedValue({ error: "Error(Contract, #14)" });
    await expect(buildCheckCoverageEnvelope(params)).rejects.toThrow(
      /Error\(Contract, #14\)/,
    );
  });
});

describe("checkCoverage", () => {
  it("signs, submits and polls, reporting the stages in order", async () => {
    const stages: string[] = [];
    const signTransaction = vi.fn().mockResolvedValue({ signedTxXdr: "s" });
    const result = await checkCoverage({
      ...params,
      signTransaction,
      onStageChange: (stage) => stages.push(stage),
    });
    expect(result).toEqual({ hash: "tx-hash" });
    expect(stages).toEqual(["awaiting-signature", "submitting", "confirming"]);
    expect(signTransaction).toHaveBeenCalledWith("env-xdr", {
      networkPassphrase: params.networkPassphrase,
      address: "GCALLER",
    });
  });

  it("throws when the transaction does not succeed", async () => {
    m.poll.mockResolvedValue({ status: "FAILED" });
    await expect(
      checkCoverage({
        ...params,
        signTransaction: vi.fn().mockResolvedValue({ signedTxXdr: "s" }),
      }),
    ).rejects.toThrow(/failed with status FAILED/);
  });
});

describe("direct inspection writes", () => {
  const caller = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 1));
  const direct = {
    registryId: "CSEC",
    caller,
    rpcUrl: "https://rpc.test",
    networkPassphrase: "Test SDF Network ; September 2015",
    signTransaction: vi.fn().mockResolvedValue({ signedTxXdr: "s" }),
  };
  const inspection = {
    inspector: caller,
    kind: "StockCount" as const,
    inspectedAt: 1798675200,
    region: "Santos",
    siteHash: "cd".repeat(32),
    quantity: "10",
    grade: "0",
    certificateHash: "ab".repeat(32),
    certificateNo: "C-1",
  };

  it("calls record_inspection on the registry with the wallet as source and returns the u32 id", async () => {
    m.poll.mockResolvedValue({
      status: "SUCCESS",
      returnValue: xdr.ScVal.scvU32(42),
    });
    const stages: string[] = [];
    const result = await recordInspection({
      ...direct,
      recordId: 7,
      inspection,
      onStageChange: (stage) => stages.push(stage),
    });
    expect(result).toEqual({ hash: "tx-hash", inspectionId: 42 });
    expect(stages).toEqual(["awaiting-signature", "submitting", "confirming"]);
    expect(m.getAccount).toHaveBeenCalledWith(caller);
    const [method, ...args] = m.call.mock.calls[0]!;
    expect(method).toBe("record_inspection");
    expect(args.map((a: xdr.ScVal) => a.switch().name)).toEqual([
      "scvAddress",
      "scvU32",
      "scvMap",
    ]);
  });

  it("returns a null inspection id when the return value is absent", async () => {
    await expect(
      recordInspection({ ...direct, recordId: 7, inspection }),
    ).resolves.toEqual({ hash: "tx-hash", inspectionId: null });
  });

  it("calls approve_inspection with the caller and the u32 id", async () => {
    await expect(
      approveInspection({ ...direct, inspectionId: 42 }),
    ).resolves.toEqual({ hash: "tx-hash" });
    const [method, ...args] = m.call.mock.calls[0]!;
    expect(method).toBe("approve_inspection");
    expect(args.map((a: xdr.ScVal) => a.switch().name)).toEqual([
      "scvAddress",
      "scvU32",
    ]);
  });

  it("surfaces simulation errors by label", async () => {
    m.isSimError.mockReturnValue(true);
    m.simulate.mockResolvedValue({ error: "Error(Contract, #31)" });
    await expect(
      approveInspection({ ...direct, inspectionId: 1 }),
    ).rejects.toThrow(/approveInspection simulation error: .*#31/);
  });
});
