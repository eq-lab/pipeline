// spec: docs/frontend/trustee-flows.md#disburse-1898
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  encodeErrorResult,
  getAddress,
} from "viem";

const { mockRead } = vi.hoisted(() => ({ mockRead: vi.fn() }));

vi.mock("./write", () => ({
  readEvmContract: mockRead,
  sendEvmContractCall: vi.fn(),
}));

import { evmDealTokenFactoryAbi, readEvmDeal } from "./dealTokenFactory";

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
