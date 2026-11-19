// spec: docs/frontend/trustee-flows.md#risk-council-pending-operations
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRead, mockSend } = vi.hoisted(() => ({
  mockRead: vi.fn(),
  mockSend: vi.fn(),
}));

vi.mock("./write", () => ({
  readEvmContract: mockRead,
  sendEvmContractCall: mockSend,
}));

import {
  accessManagerAbi,
  executeEvmScheduledOperation,
  readEvmCanCall,
  readEvmOperationSchedule,
  readEvmScheduledOperation,
  relayEvm,
} from "./accessManager";
import { evmSecurityErrorAbi } from "./securityRegistry";

const AM = "0x00000000000000000000000000000000000000a1";
const CALLER = "0x00000000000000000000000000000000000000c1";
const TARGET = "0x00000000000000000000000000000000000000d1";
const DATA =
  "0x45f225f5000000000000000000000000000000000000000000000000000000000000000a";
const HASH = `0x${"AB".repeat(32)}`;
const base = { accessManager: AM, caller: CALLER, target: TARGET };

describe("EVM AccessManager bindings", () => {
  beforeEach(() => {
    mockRead.mockReset();
    mockSend.mockReset();
  });

  it("maps canCall to immediate and delay", async () => {
    mockRead.mockResolvedValue([false, 3600]);
    await expect(
      readEvmCanCall({ ...base, selector: "0x45f225f5" }),
    ).resolves.toEqual({ immediate: false, delay: 3600 });
    expect(mockRead).toHaveBeenCalledWith(
      expect.objectContaining({
        address: AM,
        functionName: "canCall",
        args: [CALLER, TARGET, "0x45f225f5"],
      }),
    );
  });

  it("maps hashOperation and getSchedule to the API form of the id", async () => {
    mockRead.mockResolvedValueOnce(HASH).mockResolvedValueOnce(1_800_000_000);
    const schedule = await readEvmOperationSchedule({ ...base, data: DATA });
    expect(schedule).toEqual({
      operationId: "ab".repeat(32),
      readyAt: 1_800_000_000,
    });
    expect(mockRead.mock.calls[0]![0]).toMatchObject({
      functionName: "hashOperation",
      args: [CALLER, TARGET, DATA],
    });
    expect(mockRead.mock.calls[1]![0]).toMatchObject({
      functionName: "getSchedule",
      args: [HASH],
    });
  });

  it("schedules with when = 0 and the merged error ABI", async () => {
    mockSend.mockResolvedValue({ hash: "0xh" });
    await relayEvm({
      ...base,
      mode: "schedule",
      data: DATA,
      chainId: 560048,
      errorAbi: evmSecurityErrorAbi,
    });
    const sent = mockSend.mock.calls[0]![0];
    expect(sent).toMatchObject({
      address: AM,
      functionName: "schedule",
      args: [TARGET, DATA, 0],
      account: CALLER,
      chainId: 560048,
    });
    expect(sent.value).toBeUndefined();
    const names = sent.abi.map((item: { name: string }) => item.name);
    expect(names).toContain("schedule");
    expect(names).toContain("AccessManagerNotReady");
    expect(names).toContain("SecurityRegistryInvalidRatio");
  });

  it("executes with value 0", async () => {
    mockSend.mockResolvedValue({ hash: "0xh" });
    await relayEvm({ ...base, mode: "execute", data: DATA, chainId: 560048 });
    expect(mockSend.mock.calls[0]![0]).toMatchObject({
      functionName: "execute",
      args: [TARGET, DATA],
      value: 0n,
    });
    expect(
      mockSend.mock.calls[0]![0].abi.map((item: { name: string }) => item.name),
    ).toEqual(accessManagerAbi.map((item) => item.name));
  });

  it("passes the served calldata byte-identically", async () => {
    mockSend.mockResolvedValue({ hash: "0xh" });
    mockRead.mockResolvedValueOnce(HASH).mockResolvedValueOnce(5);
    await readEvmScheduledOperation({ ...base, calldata: DATA });
    expect(mockRead.mock.calls[0]![0].args[2]).toBe(DATA);
    await executeEvmScheduledOperation({
      ...base,
      calldata: DATA,
      chainId: 560048,
    });
    expect(mockSend.mock.calls[0]![0].args[1]).toBe(DATA);
    expect(mockSend.mock.calls[0]![0].functionName).toBe("execute");
  });

  it("rejects bad calldata and an empty access manager", async () => {
    await expect(
      readEvmScheduledOperation({ ...base, calldata: "0x12" }),
    ).rejects.toThrow("invalid calldata");
    await expect(
      readEvmScheduledOperation({ ...base, calldata: "nothex" }),
    ).rejects.toThrow("invalid calldata");
    await expect(
      readEvmOperationSchedule({ ...base, accessManager: "", data: DATA }),
    ).rejects.toThrow(
      "readEvmOperationSchedule: accessManager must not be empty",
    );
    await expect(
      readEvmCanCall({ ...base, target: "nope", selector: "0x45f225f5" }),
    ).rejects.toThrow("invalid target");
    expect(mockRead).not.toHaveBeenCalled();
  });
});
