// spec: docs/product-specs/staking.md#default-pockets
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  readPocket,
  readPocketClaimable,
  readPocketClaimed,
  buildClaimEnvelope,
  claimPocket,
} from "./pocket";

const {
  mockContractCall,
  mockContractCtor,
  mockGetAccount,
  mockSimulateTransaction,
  mockSendTransaction,
  mockPollTransaction,
  mockIsSimulationError,
  mockAssembleTransaction,
} = vi.hoisted(() => {
  const mockBuild = vi
    .fn()
    .mockReturnValue({ toXDR: vi.fn().mockReturnValue("assembled-xdr") });
  return {
    mockContractCall: vi.fn().mockReturnValue("op"),
    mockContractCtor: vi.fn(),
    mockGetAccount: vi.fn(),
    mockSimulateTransaction: vi.fn(),
    mockSendTransaction: vi.fn(),
    mockPollTransaction: vi.fn(),
    mockIsSimulationError: vi.fn().mockReturnValue(false),
    mockAssembleTransaction: vi.fn().mockReturnValue({ build: mockBuild }),
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
    addOperation() {
      return {
        setTimeout: () => ({ build: () => ({ toXDR: () => "assembled-xdr" }) }),
      };
    }
    static fromXDR() {
      return "signed-tx";
    }
  }
  class MockAccount {}
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
    scValToNative: vi.fn(
      (v: { __native?: unknown } | undefined) => v?.__native,
    ),
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

const POCKET_ID = "CPOCKET";
const HOLDER = "GDH66JAF6T5MD45GUGR7T7ITDRDX3Z5OMISPQZKK6LHJ3CW3VPC53KIU";
const RPC_URL = "https://soroban-testnet.stellar.org";
const PASSPHRASE = "Test SDF Network ; September 2015";

const base = {
  pocketId: POCKET_ID,
  loanId: 7,
  rpcUrl: RPC_URL,
  networkPassphrase: PASSPHRASE,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockIsSimulationError.mockReturnValue(false);
  mockGetAccount.mockResolvedValue({ accountId: () => HOLDER });
  mockSimulateTransaction.mockResolvedValue({ result: { retval: "retval" } });
  mockSendTransaction.mockResolvedValue({ status: "PENDING", hash: "tx-hash" });
  mockPollTransaction.mockResolvedValue({ status: "SUCCESS" });
});

function simulateNative(native: unknown) {
  mockSimulateTransaction.mockResolvedValue({
    result: { retval: { __native: native } },
  });
}

describe("readPocket", () => {
  it("decodes the balance and reads pocket(loan_id) with a u32", async () => {
    simulateNative({ balance: 12_500_000n });
    await expect(readPocket(base)).resolves.toEqual({ balance: "12500000" });
    expect(mockContractCtor).toHaveBeenCalledWith(POCKET_ID);
    expect(mockContractCall).toHaveBeenCalledWith("pocket", {
      t: "u32",
      v: 7,
    });
  });

  it("returns a null balance when the field is absent", async () => {
    simulateNative({});
    await expect(readPocket(base)).resolves.toEqual({ balance: null });
  });

  it("returns null when the pocket does not exist", async () => {
    mockIsSimulationError.mockReturnValue(true);
    mockSimulateTransaction.mockResolvedValue({
      error: "HostError: Error(Contract, #2)",
    });
    await expect(readPocket(base)).resolves.toBeNull();
  });

  it("rethrows any other simulation error", async () => {
    mockIsSimulationError.mockReturnValue(true);
    mockSimulateTransaction.mockResolvedValue({ error: "HostError: Budget" });
    await expect(readPocket(base)).rejects.toThrow(/Budget/);
  });

  it("guards an empty pocket id", async () => {
    await expect(readPocket({ ...base, pocketId: "" })).rejects.toThrow(
      /pocketId must not be empty/,
    );
  });
});

describe("readPocketClaimable / readPocketClaimed", () => {
  it("stringifies the i128 and passes (holder, loan_id)", async () => {
    simulateNative(1_234_567n);
    await expect(
      readPocketClaimable({ ...base, holder: HOLDER }),
    ).resolves.toBe("1234567");
    expect(mockContractCall).toHaveBeenLastCalledWith(
      "claimable",
      { t: "address", v: HOLDER },
      { t: "u32", v: 7 },
    );
    simulateNative(0n);
    await expect(readPocketClaimed({ ...base, holder: HOLDER })).resolves.toBe(
      "0",
    );
    expect(mockContractCall).toHaveBeenLastCalledWith(
      "claimed",
      { t: "address", v: HOLDER },
      { t: "u32", v: 7 },
    );
  });
});

describe("buildClaimEnvelope", () => {
  const params = { ...base, holder: HOLDER };

  it("calls claim(holder, loan_id) with the holder as source account", async () => {
    await expect(buildClaimEnvelope(params)).resolves.toBe("assembled-xdr");
    expect(mockGetAccount).toHaveBeenCalledWith(HOLDER);
    expect(mockContractCall).toHaveBeenCalledWith(
      "claim",
      { t: "address", v: HOLDER },
      { t: "u32", v: 7 },
    );
  });

  it("surfaces the simulation error and guards empty ids", async () => {
    mockIsSimulationError.mockReturnValue(true);
    mockSimulateTransaction.mockResolvedValue({ error: "HostError: #5" });
    await expect(buildClaimEnvelope(params)).rejects.toThrow(
      "claimPocket simulation error: HostError: #5",
    );
    await expect(buildClaimEnvelope({ ...params, holder: "" })).rejects.toThrow(
      /holder must not be empty/,
    );
  });
});

describe("claimPocket", () => {
  function params(overrides: Record<string, unknown> = {}) {
    return {
      ...base,
      holder: HOLDER,
      signTransaction: vi.fn().mockResolvedValue({ signedTxXdr: "signed" }),
      ...overrides,
    };
  }

  it("reports stages, signs as the holder and decodes the claimed amount", async () => {
    mockPollTransaction.mockResolvedValue({
      status: "SUCCESS",
      returnValue: { __native: 4_200_000n },
    });
    const stages: string[] = [];
    const signTransaction = vi
      .fn()
      .mockResolvedValue({ signedTxXdr: "signed" });
    const result = await claimPocket(
      params({ signTransaction, onStageChange: (s: string) => stages.push(s) }),
    );
    expect(stages).toEqual(["awaiting-signature", "submitting", "confirming"]);
    expect(signTransaction).toHaveBeenCalledWith("assembled-xdr", {
      networkPassphrase: PASSPHRASE,
      address: HOLDER,
    });
    expect(result).toEqual({ hash: "tx-hash", amount: "4200000" });
  });

  it("returns a null amount when the return value does not decode", async () => {
    await expect(claimPocket(params())).resolves.toEqual({
      hash: "tx-hash",
      amount: null,
    });
  });

  it("never signs when the simulation fails", async () => {
    mockIsSimulationError.mockReturnValue(true);
    mockSimulateTransaction.mockResolvedValue({ error: "boom" });
    const signTransaction = vi.fn();
    await expect(claimPocket(params({ signTransaction }))).rejects.toThrow(
      /simulation error/,
    );
    expect(signTransaction).not.toHaveBeenCalled();
  });

  it("throws on sendTransaction ERROR and non-SUCCESS polls", async () => {
    mockSendTransaction.mockResolvedValue({ status: "ERROR", hash: "bad" });
    await expect(claimPocket(params())).rejects.toThrow(
      /sendTransaction failed/,
    );
    mockSendTransaction.mockResolvedValue({ status: "PENDING", hash: "h" });
    mockPollTransaction.mockResolvedValue({ status: "FAILED" });
    await expect(claimPocket(params())).rejects.toThrow(
      /failed with status FAILED/,
    );
  });
});
