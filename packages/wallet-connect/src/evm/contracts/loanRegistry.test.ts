// spec: docs/frontend/trustee-flows.md#chain-first-approve-ordering-831
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  UserRejectedRequestError,
  decodeFunctionData,
  encodeAbiParameters,
  encodeErrorResult,
  encodeEventTopics,
  toEventSelector,
  toFunctionSelector,
} from "viem";

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock("./write", async () => {
  const actual = await vi.importActual<typeof import("./write")>("./write");
  return {
    readEvmContract: vi.fn(),
    sendEvmContractCall: mockSend,
    sendEvmContractCallChecked: (
      label: string,
      params: Parameters<typeof actual.sendEvmContractCallChecked>[1],
    ) => actual.sendEvmContractCallChecked(label, params, mockSend),
  };
});

import {
  closeEvmLoan,
  drawEvmLoan,
  encodeEvmCloseLoanCalldata,
  encodeEvmDrawLoanCalldata,
  encodeEvmRolloverCalldata,
  encodeEvmUpdateMutableCalldata,
  evmLoanRegistryDrawAbi,
  evmLoanRegistryLifecycleAbi,
  readEvmDrawnLoanId,
  rolloverEvmLoan,
  updateEvmMutable,
} from "./loanRegistry";
import { accessManagerAbi } from "./accessManager";
import { evmLoanRegistryErrorAbi } from "./riskCouncil";
import type { DrawLoanArgs } from "../../stellar/contracts/loanRegistry";

const REGISTRY = "0x00000000000000000000000000000000000000B1";
const OTHER = "0x00000000000000000000000000000000000000d1";
const AM = "0x00000000000000000000000000000000000000a1";
const CALLER = "0x00000000000000000000000000000000000000c1";
const HASH = `0x${"11".repeat(32)}` as const;
const BORROWER = "AE".repeat(32);
const UINT256_MAX = 2n ** 256n - 1n;

function args(overrides: Partial<DrawLoanArgs["economics"]> = {}) {
  return {
    metadata_uri: "ipfs://Qm_doc",
    economics: {
      borrower_ref: BORROWER,
      original_facility_size: "100000000000",
      original_senior_tranche: "80000000000",
      original_equity_tranche: "20000000000",
      original_offtaker_price: "105000000000",
      senior_interest_rate: 120000,
      origination_date: 1_700_000_000,
      original_maturity_date: 1_715_000_000,
      ...overrides,
    },
  } satisfies DrawLoanArgs;
}

function drawnLog(address: string, loanId: bigint) {
  return {
    address,
    topics: encodeEventTopics({
      abi: evmLoanRegistryDrawAbi,
      eventName: "LoanDrawn",
      args: { loanId },
    }),
    data: encodeAbiParameters([{ type: "string" }], ["ipfs://Qm_doc"]),
  };
}

function revertError() {
  const data = encodeErrorResult({
    abi: evmLoanRegistryErrorAbi,
    errorName: "LoanRegistryInvalidTranches",
  });
  return new ContractFunctionExecutionError(
    new ContractFunctionRevertedError({
      abi: evmLoanRegistryErrorAbi,
      data,
      functionName: "execute",
    }),
    { abi: accessManagerAbi, functionName: "execute", args: [REGISTRY, "0x"] },
  );
}

beforeEach(() => {
  mockSend.mockReset();
  mockSend.mockResolvedValue({
    hash: HASH,
    receipt: { status: "success", logs: [drawnLog(REGISTRY, 4n)] },
  });
});

describe("contract pins 150631a", () => {
  it("drawLoan selector and LoanDrawn topic", () => {
    const fn = evmLoanRegistryDrawAbi[0];
    expect(toFunctionSelector(fn)).toBe("0x675ebc7d");
    expect(
      toFunctionSelector(
        "drawLoan(string,(bytes32,uint256,uint256,uint256,uint256,uint32,uint64,uint64))",
      ),
    ).toBe("0x675ebc7d");
    expect(toEventSelector(evmLoanRegistryDrawAbi[1])).toBe(
      "0xdf2dba44629cba51ed5785f00e2a11ffaa5deca1731c5de56792d7f0858cfa32",
    );
  });

  it("struct order matches ImmutableLoanData", () => {
    const economics = evmLoanRegistryDrawAbi[0].inputs[1].components;
    expect(economics.map((c) => `${c.type} ${c.name}`)).toEqual([
      "bytes32 borrowerRef",
      "uint256 originalFacilitySize",
      "uint256 originalSeniorTranche",
      "uint256 originalEquityTranche",
      "uint256 originalOfftakerPrice",
      "uint32 seniorInterestRate",
      "uint64 originationDate",
      "uint64 originalMaturityDate",
    ]);
  });
});

describe("encodeEvmDrawLoanCalldata", () => {
  it("round-trips through drawLoan", () => {
    const data = encodeEvmDrawLoanCalldata(args());
    expect(data.startsWith("0x675ebc7d")).toBe(true);
    const decoded = decodeFunctionData({
      abi: evmLoanRegistryDrawAbi,
      data,
    });
    expect(decoded.functionName).toBe("drawLoan");
    expect(decoded.args).toEqual([
      "ipfs://Qm_doc",
      {
        borrowerRef: `0x${BORROWER.toLowerCase()}`,
        originalFacilitySize: 100000000000n,
        originalSeniorTranche: 80000000000n,
        originalEquityTranche: 20000000000n,
        originalOfftakerPrice: 105000000000n,
        seniorInterestRate: 120000,
        originationDate: 1_700_000_000n,
        originalMaturityDate: 1_715_000_000n,
      },
    ]);
  });

  it.each([
    ["metadata_uri", { ...args(), metadata_uri: "  " }],
    ["economics", { ...args(), economics: undefined as never }],
    ["economics.borrower_ref", args({ borrower_ref: "ab".repeat(31) + "a" })],
    [
      "economics.original_facility_size",
      args({ original_facility_size: "1.5" }),
    ],
    [
      "economics.original_senior_tranche",
      args({ original_senior_tranche: (UINT256_MAX + 1n).toString() }),
    ],
    ["economics.senior_interest_rate", args({ senior_interest_rate: 2 ** 32 })],
    ["economics.origination_date", args({ origination_date: -1 })],
    ["economics.original_maturity_date", args({ original_maturity_date: 1.5 })],
  ])("rejects invalid %s", (field, bad) => {
    expect(() => encodeEvmDrawLoanCalldata(bad)).toThrow(
      `drawEvmLoan: invalid draw_loan input ${field}`,
    );
  });

  it("accepts uint256 max", () => {
    expect(() =>
      encodeEvmDrawLoanCalldata(
        args({ original_offtaker_price: UINT256_MAX.toString() }),
      ),
    ).not.toThrow();
  });
});

describe("readEvmDrawnLoanId", () => {
  const receipt = (...logs: ReturnType<typeof drawnLog>[]) =>
    ({
      logs,
    }) as never;

  it("reads the id from the registry log, case-insensitively", () => {
    expect(
      readEvmDrawnLoanId(
        receipt(drawnLog(REGISTRY.toLowerCase(), 12n)),
        REGISTRY,
      ),
    ).toBe(12);
  });

  it("returns 0 as 0", () => {
    expect(readEvmDrawnLoanId(receipt(drawnLog(REGISTRY, 0n)), REGISTRY)).toBe(
      0,
    );
  });

  it("ignores a log from another address", () => {
    expect(
      readEvmDrawnLoanId(receipt(drawnLog(OTHER, 3n)), REGISTRY),
    ).toBeNull();
  });

  it("returns null without a log", () => {
    expect(readEvmDrawnLoanId(receipt(), REGISTRY)).toBeNull();
  });

  it("returns null above MAX_SAFE_INTEGER", () => {
    const big = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
    expect(
      readEvmDrawnLoanId(receipt(drawnLog(REGISTRY, big)), REGISTRY),
    ).toBeNull();
    const ok = BigInt(Number.MAX_SAFE_INTEGER);
    expect(readEvmDrawnLoanId(receipt(drawnLog(REGISTRY, ok)), REGISTRY)).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });
});

describe("drawEvmLoan", () => {
  const base = {
    accessManager: AM,
    registry: REGISTRY,
    caller: CALLER,
    chainId: 560048,
    args: args(),
  };

  it("executes drawLoan through the AccessManager", async () => {
    const onStageChange = vi.fn();
    const result = await drawEvmLoan({ ...base, onStageChange });
    expect(result).toEqual({ hash: HASH, loanId: 4 });
    expect(mockSend).toHaveBeenCalledTimes(1);
    const call = mockSend.mock.calls[0]![0];
    expect(call).toMatchObject({
      address: AM,
      functionName: "execute",
      args: [REGISTRY, encodeEvmDrawLoanCalldata(args())],
      value: 0n,
      account: CALLER,
      chainId: 560048,
    });
    const names = (call.abi as { name?: string }[]).map((i) => i.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "execute",
        "AccessManagerUnauthorizedCall",
        "LoanRegistryInvalidTranches",
        "EnforcedPause",
      ]),
    );
  });

  it("forwards stages", async () => {
    const stages: string[] = [];
    mockSend.mockImplementation(async (p) => {
      p.onStageChange("awaiting-signature");
      p.onStageChange("confirming");
      return { hash: HASH, receipt: { logs: [] } };
    });
    const result = await drawEvmLoan({
      ...base,
      onStageChange: (s) => stages.push(s),
    });
    expect(stages).toEqual(["awaiting-signature", "confirming"]);
    expect(result.loanId).toBeNull();
  });

  it.each([
    ["accessManager", { accessManager: "" }, "accessManager must not be empty"],
    ["accessManager", { accessManager: "0x12" }, "invalid accessManager 0x12"],
    ["registry", { registry: "" }, "registry must not be empty"],
    ["registry", { registry: "nope" }, "invalid registry nope"],
    ["caller", { caller: "" }, "caller must not be empty"],
    ["caller", { caller: "0xzz" }, "invalid caller 0xzz"],
  ])("rejects a bad %s before any call", async (_n, patch, message) => {
    await expect(drawEvmLoan({ ...base, ...patch })).rejects.toThrow(
      `drawEvmLoan: ${message}`,
    );
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("rejects invalid args before any call", async () => {
    await expect(
      drawEvmLoan({ ...base, args: args({ borrower_ref: "zz" }) }),
    ).rejects.toThrow("invalid draw_loan input economics.borrower_ref");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("wraps a revert before the wallet prompt as a simulation error", async () => {
    const err = revertError();
    mockSend.mockRejectedValue(err);
    const run = drawEvmLoan(base);
    await expect(run).rejects.toThrow(/^drawEvmLoan: simulation error: /);
    await expect(run).rejects.toThrow(/LoanRegistryInvalidTranches/);
    await expect(run).rejects.toThrow(err.message);
  });

  it("passes a revert after the prompt through unchanged", async () => {
    const err = revertError();
    mockSend.mockImplementation(async (p) => {
      p.onStageChange("awaiting-signature");
      throw err;
    });
    await expect(drawEvmLoan(base)).rejects.toBe(err);
  });

  it("passes a non-revert error before the prompt through unchanged", async () => {
    const err = new UserRejectedRequestError(new Error("denied"));
    mockSend.mockRejectedValue(err);
    await expect(drawEvmLoan(base)).rejects.toBe(err);
  });
});

describe("lifecycle selectors", () => {
  it.each([
    [0, "0x0971a074", "rollover(uint256,uint32,uint64)"],
    [1, "0x206293ef", "updateMutable(uint256,uint8,string)"],
    [2, "0xd0cdfd5a", "closeLoan(uint256,uint8)"],
  ])("pins %s", (i, selector, signature) => {
    expect(toFunctionSelector(evmLoanRegistryLifecycleAbi[i]!)).toBe(selector);
    expect(toFunctionSelector(signature)).toBe(selector);
  });
});

describe("lifecycle encoders", () => {
  it("rollover sends bps x 100", () => {
    const data = encodeEvmRolloverCalldata(7, 1450, 1_900_000_000);
    const decoded = decodeFunctionData({
      abi: evmLoanRegistryLifecycleAbi,
      data,
    });
    expect(decoded.functionName).toBe("rollover");
    expect(decoded.args).toEqual([7n, 145000, 1_900_000_000n]);
  });

  it("updateMutable maps the status name and keeps the URI verbatim", () => {
    for (const uri of ["", "  ipfs://x  ", "ipfs://Qm"]) {
      const decoded = decodeFunctionData({
        abi: evmLoanRegistryLifecycleAbi,
        data: encodeEvmUpdateMutableCalldata(3, "WatchList", uri),
      });
      expect(decoded.args).toEqual([3n, 2, uri]);
    }
  });

  it("closeLoan maps the reason name", () => {
    const reason = (name: string) =>
      decodeFunctionData({
        abi: evmLoanRegistryLifecycleAbi,
        data: encodeEvmCloseLoanCalldata(3, name),
      }).args;
    expect(reason("ScheduledMaturity")).toEqual([3n, 1]);
    expect(reason("EarlyRepayment")).toEqual([3n, 2]);
  });

  it.each([
    ["id -1", () => encodeEvmRolloverCalldata(-1, 1450, 1)],
    ["id 1.5", () => encodeEvmUpdateMutableCalldata(1.5, "Performing", "")],
    ["rate 0", () => encodeEvmRolloverCalldata(1, 0, 1)],
    ["rate 10001", () => encodeEvmRolloverCalldata(1, 10_001, 1)],
    ["maturity 0", () => encodeEvmRolloverCalldata(1, 1450, 0)],
    ["status Matured", () => encodeEvmUpdateMutableCalldata(1, "Matured", "")],
    ["reason None", () => encodeEvmCloseLoanCalldata(1, "None")],
    ["reason Foo", () => encodeEvmCloseLoanCalldata(1, "Foo")],
    ["close id -1", () => encodeEvmCloseLoanCalldata(-1, "EarlyRepayment")],
  ])("rejects %s", (_n, run) => {
    expect(run).toThrow(/: invalid /);
  });
});

describe("lifecycle senders", () => {
  const base = {
    accessManager: AM,
    registry: REGISTRY,
    caller: CALLER,
    chainId: 560048,
  };
  const senders = [
    [
      "rolloverEvmLoan",
      () =>
        rolloverEvmLoan({
          ...base,
          loanId: 7,
          newRateBps: 1450,
          newMaturity: 1_900_000_000,
        }),
      encodeEvmRolloverCalldata(7, 1450, 1_900_000_000),
    ],
    [
      "updateEvmMutable",
      () =>
        updateEvmMutable({
          ...base,
          loanId: 7,
          status: "Performing",
          metadataUri: "ipfs://x",
        }),
      encodeEvmUpdateMutableCalldata(7, "Performing", "ipfs://x"),
    ],
    [
      "closeEvmLoan",
      () => closeEvmLoan({ ...base, loanId: 7, reason: "EarlyRepayment" }),
      encodeEvmCloseLoanCalldata(7, "EarlyRepayment"),
    ],
  ] as const;

  it.each(senders)(
    "%s routes through AccessManager.execute",
    async (_l, run, calldata) => {
      await expect(run()).resolves.toEqual({ hash: HASH });
      const call = mockSend.mock.calls[0]![0];
      expect(call).toMatchObject({
        address: AM,
        functionName: "execute",
        args: [REGISTRY, calldata],
        value: 0n,
        account: CALLER,
        chainId: 560048,
      });
      const names = call.abi.map((i: { name?: string }) => i.name);
      for (const name of [
        "execute",
        "AccessManagerUnauthorizedCall",
        "LoanRegistryNotMatured",
        "EnforcedPause",
      ]) {
        expect(names).toContain(name);
      }
    },
  );

  it.each(senders)(
    "%s uses its own label in the simulation error",
    async (label, run) => {
      mockSend.mockRejectedValue(revertError());
      await expect(run()).rejects.toThrow(
        new RegExp(`^${label}: simulation error: `),
      );
    },
  );

  it("rejects empty addresses before any call", async () => {
    await expect(
      closeEvmLoan({
        ...base,
        accessManager: "",
        loanId: 1,
        reason: "EarlyRepayment",
      }),
    ).rejects.toThrow("closeEvmLoan: accessManager must not be empty");
    await expect(
      closeEvmLoan({
        ...base,
        registry: "nope",
        loanId: 1,
        reason: "EarlyRepayment",
      }),
    ).rejects.toThrow("closeEvmLoan: invalid registry nope");
    await expect(
      rolloverEvmLoan({
        ...base,
        caller: "",
        loanId: 1,
        newRateBps: 1,
        newMaturity: 1,
      }),
    ).rejects.toThrow("rolloverEvmLoan: caller must not be empty");
    await expect(
      updateEvmMutable({
        ...base,
        loanId: -1,
        status: "Performing",
        metadataUri: "",
      }),
    ).rejects.toThrow("encodeEvmUpdateMutableCalldata: invalid loanId -1");
    expect(mockSend).not.toHaveBeenCalled();
  });
});
