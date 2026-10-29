// spec: docs/product-specs/loan-repayment-recovery.md
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  readCanCall,
  readOperationSchedule,
  buildRelayEnvelope,
  relay,
  type RelayStage,
} from "./accessManager";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockContractCall,
  mockContractCtor,
  mockGetAccount,
  mockSimulateTransaction,
  mockSendTransaction,
  mockPollTransaction,
  mockIsSimulationError,
  mockAssembleTransaction,
  mockFromXDR,
  mockAddOperation,
} = vi.hoisted(() => {
  const mockBuild = vi
    .fn()
    .mockReturnValue({ toXDR: vi.fn().mockReturnValue("assembled-xdr") });
  const mockSetTimeout = vi.fn().mockReturnValue({ build: mockBuild });
  const mockAddOperation = vi
    .fn()
    .mockReturnValue({ setTimeout: mockSetTimeout });

  return {
    mockContractCall: vi.fn().mockReturnValue("op"),
    mockContractCtor: vi.fn(),
    mockGetAccount: vi.fn(),
    mockSimulateTransaction: vi.fn(),
    mockSendTransaction: vi.fn(),
    mockPollTransaction: vi.fn(),
    mockIsSimulationError: vi.fn().mockReturnValue(false),
    mockAssembleTransaction: vi.fn().mockReturnValue({ build: mockBuild }),
    mockFromXDR: vi.fn().mockReturnValue("signed-tx"),
    mockAddOperation,
  };
});

vi.mock("@stellar/stellar-sdk", () => {
  class MockContract {
    constructor(id: string) {
      mockContractCtor(id);
    }
    call(method: string, ...args: unknown[]) {
      return mockContractCall(method, ...args);
    }
  }
  class MockServer {
    getAccount(...args: unknown[]) {
      return mockGetAccount(...args);
    }
    simulateTransaction(...args: unknown[]) {
      return mockSimulateTransaction(...args);
    }
    sendTransaction(...args: unknown[]) {
      return mockSendTransaction(...args);
    }
    pollTransaction(...args: unknown[]) {
      return mockPollTransaction(...args);
    }
  }
  class MockTransactionBuilder {
    constructor(
      public _account: unknown,
      public _opts: unknown,
    ) {}
    addOperation(op: unknown) {
      return mockAddOperation(op);
    }
    static fromXDR(...args: unknown[]) {
      return mockFromXDR(...args);
    }
  }
  class MockAccount {
    constructor(
      public id: string,
      public seq: string,
    ) {}
  }
  class MockAddress {
    constructor(public addr: string) {}
    toScVal() {
      return { t: "address", v: this.addr };
    }
  }

  return {
    Account: MockAccount,
    Contract: MockContract,
    TransactionBuilder: MockTransactionBuilder,
    BASE_FEE: "100",
    Address: MockAddress,
    nativeToScVal: vi.fn((value: unknown, opts?: { type?: string }) => ({
      t: opts?.type,
      v: value,
    })),
    // Tagged stand-in: our loan-id extractor reads `.__native` off the ScVal.
    scValToNative: vi.fn(
      (v: { __native?: unknown } | undefined) => v?.__native,
    ),
    xdr: {
      ScVal: {
        scvString: (v: string) => ({ t: "string", v }),
        scvU32: (v: number) => ({ t: "u32", v }),
        scvSymbol: (v: string) => ({ t: "symbol", v }),
        scvVec: (v: unknown[]) => ({ t: "vec", v }),
        scvMap: (v: unknown[]) => ({ t: "map", v }),
      },
      ScMapEntry: class {
        key: unknown;
        val: unknown;
        constructor({ key, val }: { key: unknown; val: unknown }) {
          this.key = key;
          this.val = val;
        }
      },
    },
    rpc: {
      Server: MockServer,
      Api: {
        isSimulationError: mockIsSimulationError,
        GetTransactionStatus: { SUCCESS: "SUCCESS" },
      },
      assembleTransaction: mockAssembleTransaction,
    },
  };
});

const AM_ID = "CDP7TUNBGIKDBGEUZCA6WEDVJ7BTJFXNIPQF6HWEDV7SAAS7VN75WHTW";
const MINTER_ID = "CAPL5WN3FAUAD3TTUNU7NTEMKCW24D7GM7UXJMNYRS6BHO3WTAJKAIFK";
const CALLER = "GAZFDDYKOOHWNMBAQWDURXBV3WNFQIT4UR2NWV5SGTKA4CCV7LIEZH6G";
const RPC_URL = "https://soroban-testnet.stellar.org";
const PASSPHRASE = "Test SDF Network ; September 2015";
const OP_ARGS = [{ t: "u32", v: 7 }] as never[];

const base = {
  accessManagerId: AM_ID,
  caller: CALLER,
  target: MINTER_ID,
  fn: "reverse_repay",
  rpcUrl: RPC_URL,
  networkPassphrase: PASSPHRASE,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockIsSimulationError.mockReturnValue(false);
  mockGetAccount.mockResolvedValue({ accountId: () => CALLER });
  mockSimulateTransaction.mockResolvedValue({ result: { retval: "retval" } });
  mockSendTransaction.mockResolvedValue({ status: "PENDING", hash: "tx-hash" });
  mockPollTransaction.mockResolvedValue({ status: "SUCCESS" });
});

describe("readCanCall", () => {
  it("simulates can_call(caller, target, function) read-only", async () => {
    mockSimulateTransaction.mockResolvedValue({
      result: { retval: { __native: { immediate: false, delay: 86400 } } },
    });
    await expect(readCanCall(base)).resolves.toEqual({
      immediate: false,
      delay: 86400,
    });
    expect(mockContractCall).toHaveBeenCalledWith(
      "can_call",
      { t: "address", v: CALLER },
      { t: "address", v: MINTER_ID },
      { t: "symbol", v: "reverse_repay" },
    );
    expect(mockGetAccount).not.toHaveBeenCalled();
  });

  it("parses an immediate grant and bigint delay", async () => {
    mockSimulateTransaction.mockResolvedValue({
      result: { retval: { __native: { immediate: true, delay: 0n } } },
    });
    await expect(readCanCall(base)).resolves.toEqual({
      immediate: true,
      delay: 0,
    });
  });

  it("guards empty ids and surfaces a simulation error", async () => {
    await expect(readCanCall({ ...base, accessManagerId: "" })).rejects.toThrow(
      /accessManagerId must not be empty/,
    );
    await expect(readCanCall({ ...base, caller: "" })).rejects.toThrow(
      /caller must not be empty/,
    );
    mockIsSimulationError.mockReturnValue(true);
    mockSimulateTransaction.mockResolvedValue({ error: "boom" });
    await expect(readCanCall(base)).rejects.toThrow(
      "can_call simulation error: boom",
    );
  });
});

describe("readOperationSchedule", () => {
  it("hashes the operation, then reads its schedule", async () => {
    const hash = new Uint8Array(32).fill(0xab);
    mockSimulateTransaction
      .mockResolvedValueOnce({ result: { retval: { __native: hash } } })
      .mockResolvedValueOnce({ result: { retval: { __native: 1_800_000n } } });
    const out = await readOperationSchedule({ ...base, args: OP_ARGS });
    expect(out).toEqual({ operationId: "ab".repeat(32), readyAt: 1_800_000 });
    expect(mockContractCall).toHaveBeenNthCalledWith(
      1,
      "hash_operation",
      { t: "address", v: CALLER },
      { t: "address", v: MINTER_ID },
      { t: "symbol", v: "reverse_repay" },
      { t: "vec", v: OP_ARGS },
    );
    expect(mockContractCall).toHaveBeenNthCalledWith(2, "get_schedule", {
      t: "bytes",
      v: hash,
    });
  });

  it("passes a zero schedule through", async () => {
    mockSimulateTransaction
      .mockResolvedValueOnce({
        result: { retval: { __native: new Uint8Array(32) } },
      })
      .mockResolvedValueOnce({ result: { retval: { __native: 0n } } });
    await expect(
      readOperationSchedule({ ...base, args: OP_ARGS }),
    ).resolves.toMatchObject({ readyAt: 0 });
  });

  it("guards an empty target", async () => {
    await expect(
      readOperationSchedule({ ...base, target: "", args: OP_ARGS }),
    ).rejects.toThrow(/target must not be empty/);
  });
});

describe("buildRelayEnvelope", () => {
  it("builds schedule(target, fn, args, 0, caller) with the caller as source", async () => {
    await expect(
      buildRelayEnvelope({ ...base, mode: "schedule", args: OP_ARGS }),
    ).resolves.toBe("assembled-xdr");
    expect(mockContractCtor).toHaveBeenCalledWith(AM_ID);
    expect(mockContractCall).toHaveBeenCalledWith(
      "schedule",
      { t: "address", v: MINTER_ID },
      { t: "symbol", v: "reverse_repay" },
      { t: "vec", v: OP_ARGS },
      { t: "u64", v: 0n },
      { t: "address", v: CALLER },
    );
    expect(mockGetAccount).toHaveBeenCalledWith(CALLER);
  });

  it("builds execute(target, fn, args, caller)", async () => {
    await buildRelayEnvelope({ ...base, mode: "execute", args: OP_ARGS });
    expect(mockContractCall).toHaveBeenCalledWith(
      "execute",
      { t: "address", v: MINTER_ID },
      { t: "symbol", v: "reverse_repay" },
      { t: "vec", v: OP_ARGS },
      { t: "address", v: CALLER },
    );
  });

  it("names the mode in the simulation error", async () => {
    mockIsSimulationError.mockReturnValue(true);
    mockSimulateTransaction.mockResolvedValue({
      error: "HostError: Error(Contract, #7)",
    });
    await expect(
      buildRelayEnvelope({ ...base, mode: "execute", args: OP_ARGS }),
    ).rejects.toThrow(
      "execute simulation error: HostError: Error(Contract, #7)",
    );
  });

  it("guards empty ids before any RPC call", async () => {
    await expect(
      buildRelayEnvelope({
        ...base,
        accessManagerId: "",
        mode: "execute",
        args: OP_ARGS,
      }),
    ).rejects.toThrow(/accessManagerId must not be empty/);
    expect(mockGetAccount).not.toHaveBeenCalled();
  });
});

describe("relay", () => {
  function params(overrides: Record<string, unknown> = {}) {
    return {
      ...base,
      mode: "execute" as const,
      args: OP_ARGS,
      signTransaction: vi.fn().mockResolvedValue({ signedTxXdr: "signed" }),
      ...overrides,
    };
  }

  it("runs build, sign, submit, poll with ordered stages", async () => {
    const stages: RelayStage[] = [];
    const p = params({ onStageChange: (s: RelayStage) => stages.push(s) });
    await expect(relay(p)).resolves.toEqual({ hash: "tx-hash" });
    expect(stages).toEqual(["awaiting-signature", "submitting", "confirming"]);
    expect(p.signTransaction).toHaveBeenCalledWith("assembled-xdr", {
      networkPassphrase: PASSPHRASE,
      address: CALLER,
    });
  });

  it("never signs when the simulation fails", async () => {
    mockIsSimulationError.mockReturnValue(true);
    mockSimulateTransaction.mockResolvedValue({ error: "boom" });
    const signTransaction = vi.fn();
    await expect(relay(params({ signTransaction }))).rejects.toThrow(
      /execute simulation error/,
    );
    expect(signTransaction).not.toHaveBeenCalled();
  });

  it("throws when send reports ERROR", async () => {
    mockSendTransaction.mockResolvedValue({ status: "ERROR", hash: "bad" });
    await expect(relay(params())).rejects.toThrow(/sendTransaction failed/);
  });

  it("throws when the poll ends in a non-SUCCESS status", async () => {
    mockPollTransaction.mockResolvedValue({ status: "FAILED" });
    await expect(relay(params({ mode: "schedule" }))).rejects.toThrow(
      /schedule: transaction tx-hash failed with status FAILED/,
    );
  });
});
