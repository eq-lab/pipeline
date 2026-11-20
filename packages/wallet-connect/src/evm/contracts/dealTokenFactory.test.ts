// spec: docs/frontend/trustee-flows.md#disburse-1898
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  encodeErrorResult,
  getAddress,
} from "viem";

const { mockRead, mockSendChecked } = vi.hoisted(() => ({
  mockRead: vi.fn(),
  mockSendChecked: vi.fn(),
}));

vi.mock("./write", () => ({
  readEvmContract: mockRead,
  sendEvmContractCall: vi.fn(),
  sendEvmContractCallChecked: mockSendChecked,
}));

import {
  encodeEvmRegisterDealCalldata,
  evmDealTokenFactoryAbi,
  evmRegisterDealErrorAbi,
  evmRegisterDealSelector,
  readEvmDeal,
  relayEvmRegisterDeal,
} from "./dealTokenFactory";

const FACTORY = "0xCf54e4d3ffcfFC663058b6966D9B8578d988eCDC";
const DEBT = "0x00000000000000000000000000000000000000d1";
const DEBT_CHECKSUM = getAddress(DEBT);

function revert(
  errorName: "DealTokenFactoryNotRegistered" | "DealTokenFactorySameValue",
) {
  const data =
    errorName === "DealTokenFactoryNotRegistered"
      ? encodeErrorResult({
          abi: evmDealTokenFactoryAbi,
          errorName,
          args: [7n],
        })
      : encodeErrorResult({ abi: evmDealTokenFactoryAbi, errorName });
  return new ContractFunctionExecutionError(
    new ContractFunctionRevertedError({
      abi: evmDealTokenFactoryAbi,
      data,
      functionName: "deal",
    }),
    { abi: evmDealTokenFactoryAbi, functionName: "deal", args: [7n] },
  );
}

beforeEach(() => {
  mockRead.mockReset();
  mockSendChecked.mockReset();
});

describe("readEvmDeal", () => {
  it("returns the checksummed debt token", async () => {
    mockRead.mockResolvedValue({ debt: DEBT });
    await expect(readEvmDeal({ factory: FACTORY, loanId: 7 })).resolves.toEqual(
      {
        debt: DEBT_CHECKSUM,
      },
    );
    expect(mockRead.mock.calls[0]![0]).toMatchObject({
      address: FACTORY,
      functionName: "deal",
      args: [7n],
    });
  });

  it("maps a NotRegistered revert to null", async () => {
    mockRead.mockRejectedValue(revert("DealTokenFactoryNotRegistered"));
    await expect(
      readEvmDeal({ factory: FACTORY, loanId: 7 }),
    ).resolves.toBeNull();
  });

  it("propagates any other error", async () => {
    const other = revert("DealTokenFactorySameValue");
    mockRead.mockRejectedValue(other);
    await expect(readEvmDeal({ factory: FACTORY, loanId: 7 })).rejects.toBe(
      other,
    );
    const rpc = new Error("rpc down");
    mockRead.mockRejectedValue(rpc);
    await expect(readEvmDeal({ factory: FACTORY, loanId: 7 })).rejects.toBe(
      rpc,
    );
  });

  it("rejects an invalid factory or loan id before any read", async () => {
    await expect(readEvmDeal({ factory: "", loanId: 7 })).rejects.toThrow(
      "readEvmDeal: factory must not be empty",
    );
    await expect(readEvmDeal({ factory: "nope", loanId: 7 })).rejects.toThrow(
      "readEvmDeal: invalid factory nope",
    );
    await expect(readEvmDeal({ factory: FACTORY, loanId: -1 })).rejects.toThrow(
      "readEvmDeal: invalid loanId -1",
    );
    expect(mockRead).not.toHaveBeenCalled();
  });
});

const AM = "0x3dF345BF5fd3ecB1F8E031B450Ceb2BF7B645992";
const CALLER = "0x96ef761fee97d6e09821517554f2316b8cbc04e4";
const SELECTOR = "0x19da0d36";

describe("registerDeal binding", () => {
  it("has the Hoodi selector", () => {
    expect(evmRegisterDealSelector()).toBe(SELECTOR);
  });

  it("encodes the loan id after the selector", () => {
    expect(encodeEvmRegisterDealCalldata(0)).toBe(
      `${SELECTOR}${"0".repeat(64)}`,
    );
    expect(encodeEvmRegisterDealCalldata(7)).toBe(
      `${SELECTOR}${"0".repeat(63)}7`,
    );
  });

  it("rejects an invalid loan id", () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => encodeEvmRegisterDealCalldata(bad)).toThrow(
        "encodeEvmRegisterDealCalldata: invalid loanId",
      );
    }
  });

  it("decodes a revert against the error ABI", () => {
    const data = encodeErrorResult({
      abi: evmRegisterDealErrorAbi,
      errorName: "DealTokenFactoryAlreadyRegistered",
      args: [7n],
    });
    const names = evmRegisterDealErrorAbi
      .filter((e) => e.type === "error")
      .map((e) => (e as { name: string }).name);
    expect(data.startsWith("0x")).toBe(true);
    expect(names).toEqual(
      expect.arrayContaining([
        "DealTokenFactoryAlreadyRegistered",
        "LoanRegistryNonExistentLoanId",
      ]),
    );
  });
});

describe("relayEvmRegisterDeal", () => {
  const base = {
    accessManager: AM,
    factory: FACTORY,
    caller: CALLER,
    loanId: 7,
    chainId: 560048,
  };

  it("executes through the AccessManager", async () => {
    mockSendChecked.mockResolvedValue({ hash: "0xabc", receipt: {} });
    const onStageChange = vi.fn();
    await expect(
      relayEvmRegisterDeal({ ...base, mode: "execute", onStageChange }),
    ).resolves.toEqual({ hash: "0xabc" });
    expect(mockSendChecked).toHaveBeenCalledTimes(1);
    const [label, params] = mockSendChecked.mock.calls[0]!;
    expect(label).toBe("registerEvmDeal");
    expect(params).toMatchObject({
      address: AM,
      functionName: "execute",
      args: [FACTORY, encodeEvmRegisterDealCalldata(7)],
      value: 0n,
      account: CALLER,
      chainId: 560048,
      onStageChange,
    });
    const abiNames = (params.abi as { name: string }[]).map((e) => e.name);
    expect(abiNames).toEqual(
      expect.arrayContaining([
        "DealTokenFactoryAlreadyRegistered",
        "LoanRegistryNonExistentLoanId",
        "AccessManagerNotScheduled",
      ]),
    );
  });

  it("schedules with no value", async () => {
    mockSendChecked.mockResolvedValue({ hash: "0xdef", receipt: {} });
    await relayEvmRegisterDeal({ ...base, mode: "schedule" });
    const params = mockSendChecked.mock.calls[0]![1];
    expect(params.functionName).toBe("schedule");
    expect(params.args).toEqual([FACTORY, encodeEvmRegisterDealCalldata(7), 0]);
    expect("value" in params).toBe(false);
  });

  it("rejects invalid inputs before any send", async () => {
    await expect(
      relayEvmRegisterDeal({ ...base, mode: "execute", accessManager: "x" }),
    ).rejects.toThrow("registerEvmDeal: invalid accessManager x");
    await expect(
      relayEvmRegisterDeal({ ...base, mode: "execute", factory: "x" }),
    ).rejects.toThrow("registerEvmDeal: invalid factory x");
    await expect(
      relayEvmRegisterDeal({ ...base, mode: "execute", caller: "x" }),
    ).rejects.toThrow("registerEvmDeal: invalid caller x");
    await expect(
      relayEvmRegisterDeal({ ...base, mode: "execute", loanId: -1 }),
    ).rejects.toThrow("encodeEvmRegisterDealCalldata: invalid loanId");
    expect(mockSendChecked).not.toHaveBeenCalled();
  });
});
