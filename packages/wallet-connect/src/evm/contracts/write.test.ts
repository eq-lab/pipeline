// spec: docs/frontend/wallet-flows.md#trustee-evm-contract-client
import { beforeEach, describe, expect, it, vi } from "vitest";

const wagmi = vi.hoisted(() => ({
  calls: [] as string[],
  getConnection: vi.fn(),
  switchChain: vi.fn(),
  simulateContract: vi.fn(),
  estimateContractGas: vi.fn(),
  writeContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  readContract: vi.fn(),
}));

vi.mock("@wagmi/core", () => ({
  getConnection: wagmi.getConnection,
  switchChain: wagmi.switchChain,
  simulateContract: wagmi.simulateContract,
  writeContract: wagmi.writeContract,
  waitForTransactionReceipt: wagmi.waitForTransactionReceipt,
  readContract: wagmi.readContract,
  getPublicClient: () => ({ estimateContractGas: wagmi.estimateContractGas }),
}));
vi.mock("../config", () => ({ initEvmWalletConnect: () => ({ id: "cfg" }) }));

import { EVM_TX_GAS_CAP, readEvmContract, sendEvmContractCall } from "./write";

const ACCOUNT = "0xAbCdEf0000000000000000000000000000000001";
const TARGET = "0x00000000000000000000000000000000000000aa";
const HASH = `0x${"11".repeat(32)}`;
const abi = [
  {
    type: "function",
    name: "ping",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
] as const;

function params(extra: object = {}) {
  return {
    abi,
    address: TARGET as `0x${string}`,
    functionName: "ping",
    args: [] as readonly unknown[],
    account: ACCOUNT,
    chainId: 560048,
    ...extra,
  };
}

describe("sendEvmContractCall", () => {
  beforeEach(() => {
    localStorage.clear();
    wagmi.calls.length = 0;
    vi.clearAllMocks();
    wagmi.getConnection.mockReturnValue({
      address: ACCOUNT.toLowerCase(),
      chainId: 560048,
    });
    wagmi.switchChain.mockImplementation(async () => {
      wagmi.calls.push("switch");
    });
    wagmi.simulateContract.mockImplementation(async () => {
      wagmi.calls.push("simulate");
    });
    wagmi.estimateContractGas.mockImplementation(async () => {
      wagmi.calls.push("estimate");
      return 100_000n;
    });
    wagmi.writeContract.mockImplementation(async () => {
      wagmi.calls.push("write");
      return HASH;
    });
    wagmi.waitForTransactionReceipt.mockImplementation(async () => {
      wagmi.calls.push("receipt");
      return { status: "success" };
    });
  });

  it("simulates, estimates, writes and waits for the receipt in order", async () => {
    const stages: string[] = [];
    const result = await sendEvmContractCall(
      params({ onStageChange: (s: string) => stages.push(s) }),
    );
    expect(result).toEqual({ hash: HASH });
    expect(wagmi.calls).toEqual(["simulate", "estimate", "write", "receipt"]);
    expect(stages).toEqual(["awaiting-signature", "confirming"]);
  });

  it("adds 20 percent to the estimate", async () => {
    await sendEvmContractCall(params());
    expect(wagmi.writeContract.mock.calls[0]![1]).toMatchObject({
      gas: 120_000n,
      chainId: 560048,
      account: ACCOUNT.toLowerCase(),
    });
  });

  it("clamps the gas to the per-transaction cap", async () => {
    wagmi.estimateContractGas.mockResolvedValue(20_000_000n);
    await sendEvmContractCall(params());
    expect(wagmi.writeContract.mock.calls[0]![1].gas).toBe(EVM_TX_GAS_CAP);
  });

  it("switches chain only on a mismatch", async () => {
    await sendEvmContractCall(params());
    expect(wagmi.switchChain).not.toHaveBeenCalled();
    wagmi.getConnection.mockReturnValue({
      address: ACCOUNT.toLowerCase(),
      chainId: 1,
    });
    await sendEvmContractCall(params());
    expect(wagmi.switchChain).toHaveBeenCalledWith(
      { id: "cfg" },
      { chainId: 560048 },
    );
    expect(wagmi.calls.slice(-5)[0]).toBe("switch");
  });

  it("passes the value to the simulation and the write", async () => {
    await sendEvmContractCall(params({ value: 0n }));
    expect(wagmi.simulateContract.mock.calls[0]![1].value).toBe(0n);
    expect(wagmi.writeContract.mock.calls[0]![1].value).toBe(0n);
  });

  it("never writes after a failed simulation", async () => {
    wagmi.simulateContract.mockRejectedValue(new Error("revert"));
    await expect(sendEvmContractCall(params())).rejects.toThrow("revert");
    expect(wagmi.writeContract).not.toHaveBeenCalled();
    expect(wagmi.estimateContractGas).not.toHaveBeenCalled();
  });

  it("throws when the receipt is not a success", async () => {
    wagmi.waitForTransactionReceipt.mockResolvedValue({ status: "reverted" });
    await expect(sendEvmContractCall(params())).rejects.toThrow(
      `transaction reverted: ${HASH}`,
    );
  });

  it("refuses the mock wallet without any RPC call", async () => {
    localStorage.setItem("pipeline.mock.wallet.address", ACCOUNT);
    await expect(sendEvmContractCall(params())).rejects.toThrow(
      "[wallet mock] EVM writes are not mockable; connect a real wallet",
    );
    expect(wagmi.getConnection).not.toHaveBeenCalled();
    expect(wagmi.simulateContract).not.toHaveBeenCalled();
  });

  it("throws before simulation when the connected account differs", async () => {
    wagmi.getConnection.mockReturnValue({
      address: "0x0000000000000000000000000000000000000002",
      chainId: 560048,
    });
    await expect(sendEvmContractCall(params())).rejects.toThrow(
      "The connected EVM wallet changed. Reconnect 0xAbCd…0001.",
    );
    expect(wagmi.simulateContract).not.toHaveBeenCalled();
  });

  it("throws when no wallet is connected", async () => {
    wagmi.getConnection.mockReturnValue({ address: undefined, chainId: 1 });
    await expect(sendEvmContractCall(params())).rejects.toThrow(
      "EVM wallet not connected.",
    );
  });
});

describe("readEvmContract", () => {
  it("reads through the memoised config", async () => {
    wagmi.readContract.mockResolvedValue(true);
    const value = await readEvmContract({
      abi,
      address: TARGET as `0x${string}`,
      functionName: "ping",
    });
    expect(value).toBe(true);
    expect(wagmi.readContract.mock.calls[0]![0]).toEqual({ id: "cfg" });
    expect(wagmi.readContract.mock.calls[0]![1]).toMatchObject({
      address: TARGET,
      functionName: "ping",
      args: [],
    });
    expect(wagmi.readContract.mock.calls[0]![1]).not.toHaveProperty(
      "blockNumber",
    );
  });

  it("pins the read to a block when asked", async () => {
    wagmi.readContract.mockResolvedValue(true);
    await readEvmContract({
      abi,
      address: TARGET as `0x${string}`,
      functionName: "ping",
      blockNumber: 99n,
    });
    expect(wagmi.readContract.mock.calls.at(-1)![1]).toMatchObject({
      blockNumber: 99n,
    });
  });
});
