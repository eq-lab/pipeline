// spec: docs/frontend/wallet-flows.md#trustee-evm-contract-client
import { beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({
  getBlockNumber: vi.fn(),
  request: vi.fn(),
  hasClient: true,
}));

vi.mock("@wagmi/core", () => ({
  getPublicClient: () =>
    client.hasClient
      ? { getBlockNumber: client.getBlockNumber, request: client.request }
      : undefined,
}));
vi.mock("../config", () => ({ initEvmWalletConnect: () => ({ id: "cfg" }) }));

import {
  EVM_LOG_CHUNK_BLOCKS,
  evmLogChunks,
  loanIdTopic,
  scanEvmLogs,
} from "./logs";

const ADDRESS = "0x00000000000000000000000000000000000000b1";
const TOPIC0 = `0x${"11".repeat(32)}` as const;
const TOPIC0_B = `0x${"22".repeat(32)}` as const;

function log(blockNumber: number) {
  return { blockNumber: `0x${blockNumber.toString(16)}` };
}

beforeEach(() => {
  client.hasClient = true;
  client.getBlockNumber.mockReset();
  client.request.mockReset();
});

describe("evmLogChunks", () => {
  it("uses the 50 000-block publicnode cap", () => {
    expect(EVM_LOG_CHUNK_BLOCKS).toBe(50_000n);
  });

  it("splits [from, head] into inclusive chunks", () => {
    expect(evmLogChunks(0n, 120_000n)).toEqual([
      [0n, 49_999n],
      [50_000n, 99_999n],
      [100_000n, 120_000n],
    ]);
  });

  it("returns one chunk when the range fits and none past the head", () => {
    expect(evmLogChunks(10n, 10n)).toEqual([[10n, 10n]]);
    expect(evmLogChunks(11n, 10n)).toEqual([]);
  });
});

describe("loanIdTopic", () => {
  it("left-pads the loan id to 32 bytes", () => {
    expect(loanIdTopic(7)).toBe(`0x${"0".repeat(63)}7`);
    expect(loanIdTopic(255n)).toBe(`0x${"0".repeat(62)}ff`);
  });
});

describe("scanEvmLogs", () => {
  it("sends raw topics and hex block bounds per chunk", async () => {
    client.getBlockNumber.mockResolvedValue(60_000n);
    client.request.mockResolvedValue([]);
    await scanEvmLogs({
      address: [ADDRESS],
      topics: [[TOPIC0, TOPIC0_B], loanIdTopic(7)],
      fromBlock: 5n,
      chainId: 560048,
    });
    expect(client.request).toHaveBeenCalledTimes(2);
    expect(client.request).toHaveBeenNthCalledWith(1, {
      method: "eth_getLogs",
      params: [
        {
          address: [ADDRESS],
          topics: [[TOPIC0, TOPIC0_B], loanIdTopic(7)],
          fromBlock: "0x5",
          toBlock: `0x${(50_004).toString(16)}`,
        },
      ],
    });
    expect(client.request).toHaveBeenNthCalledWith(2, {
      method: "eth_getLogs",
      params: [
        {
          address: [ADDRESS],
          topics: [[TOPIC0, TOPIC0_B], loanIdTopic(7)],
          fromBlock: `0x${(50_005).toString(16)}`,
          toBlock: `0x${(60_000).toString(16)}`,
        },
      ],
    });
  });

  it("keeps results in block order even when chunks finish out of order", async () => {
    client.getBlockNumber.mockResolvedValue(149_999n);
    client.request.mockImplementation(
      async ({ params }: { params: [{ fromBlock: string }] }) => {
        const from = Number.parseInt(params[0].fromBlock, 16);
        await new Promise((resolve) =>
          setTimeout(resolve, from === 0 ? 20 : 0),
        );
        return [log(from)];
      },
    );
    const logs = await scanEvmLogs({
      address: [ADDRESS],
      topics: [TOPIC0],
      fromBlock: 0n,
      chainId: 560048,
    });
    expect(logs.map((entry) => entry.blockNumber)).toEqual([
      "0x0",
      "0xc350",
      "0x186a0",
    ]);
  });

  it("rejects on the first failing chunk", async () => {
    client.getBlockNumber.mockResolvedValue(149_999n);
    client.request.mockImplementation(
      async ({ params }: { params: [{ fromBlock: string }] }) => {
        if (Number.parseInt(params[0].fromBlock, 16) === 50_000) {
          throw new Error("exceed maximum block range: 50000");
        }
        return [];
      },
    );
    await expect(
      scanEvmLogs({
        address: [ADDRESS],
        topics: [TOPIC0],
        fromBlock: 0n,
        chainId: 560048,
      }),
    ).rejects.toThrow("exceed maximum block range: 50000");
  });

  it("yields no logs when the start is past the head", async () => {
    client.getBlockNumber.mockResolvedValue(100n);
    await expect(
      scanEvmLogs({
        address: [ADDRESS],
        topics: [TOPIC0],
        fromBlock: 101n,
        chainId: 560048,
      }),
    ).resolves.toEqual([]);
    expect(client.request).not.toHaveBeenCalled();
  });

  it("limits the number of concurrent calls", async () => {
    client.getBlockNumber.mockResolvedValue(499_999n);
    let active = 0;
    let peak = 0;
    client.request.mockImplementation(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return [];
    });
    await scanEvmLogs({
      address: [ADDRESS],
      topics: [TOPIC0],
      fromBlock: 0n,
      chainId: 560048,
      concurrency: 2,
    });
    expect(client.request).toHaveBeenCalledTimes(10);
    expect(peak).toBe(2);
  });

  it("throws when the RPC client is not ready", async () => {
    client.hasClient = false;
    await expect(
      scanEvmLogs({
        address: [ADDRESS],
        topics: [TOPIC0],
        fromBlock: 0n,
        chainId: 560048,
      }),
    ).rejects.toThrow("RPC not ready");
  });
});
