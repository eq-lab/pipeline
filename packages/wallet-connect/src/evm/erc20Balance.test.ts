// spec: docs/frontend/trustee-flows.md#capital-allocation-card--data-layer
import { describe, it, expect, vi, beforeEach } from "vitest";

const readContract = vi.fn();
const createPublicClient = vi.fn(() => ({ readContract }));

vi.mock("viem", async (orig) => ({
  ...(await orig<typeof import("viem")>()),
  createPublicClient: (...args: unknown[]) =>
    (createPublicClient as (...a: unknown[]) => unknown)(...args),
}));

import { getErc20Balance } from "./erc20Balance";

const TOKEN = "0xe198F1EEF83Dd613B874FC3c2D5BAf6C8a4A4597";
const ACCOUNT = "0xE122330dBA9394BCAaAAcA580EFd21665b0FA8fA";

beforeEach(() => {
  readContract.mockReset();
  createPublicClient.mockClear();
});

describe("getErc20Balance", () => {
  it("returns raw and decimals and reads balanceOf for the account", async () => {
    readContract.mockImplementation(
      async ({ functionName }: { functionName: string }) =>
        functionName === "balanceOf" ? 10_000_000_000n : 6,
    );
    const result = await getErc20Balance({
      rpcUrl: "https://rpc-a.example",
      tokenAddress: TOKEN,
      account: ACCOUNT,
    });
    expect(result).toEqual({ raw: 10_000_000_000n, decimals: 6 });
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: TOKEN,
        functionName: "balanceOf",
        args: [ACCOUNT],
      }),
    );
  });

  it.each([
    ["", ACCOUNT],
    ["0x123", ACCOUNT],
    [TOKEN, ""],
    [TOKEN, "not-an-address"],
  ])("throws before any RPC for token %j / account %j", async (t, a) => {
    await expect(
      getErc20Balance({
        rpcUrl: "https://rpc-b.example",
        tokenAddress: t,
        account: a,
      }),
    ).rejects.toThrow(/must be a 0x address/);
    expect(createPublicClient).not.toHaveBeenCalled();
    expect(readContract).not.toHaveBeenCalled();
  });

  it("propagates an RPC rejection", async () => {
    readContract.mockRejectedValue(new Error("rate limited"));
    await expect(
      getErc20Balance({
        rpcUrl: "https://rpc-c.example",
        tokenAddress: TOKEN,
        account: ACCOUNT,
      }),
    ).rejects.toThrow("rate limited");
  });

  it("builds one client per rpc url", async () => {
    readContract.mockResolvedValue(6);
    const params = {
      rpcUrl: "https://rpc-d.example",
      tokenAddress: TOKEN,
      account: ACCOUNT,
    };
    await getErc20Balance(params);
    await getErc20Balance(params);
    expect(createPublicClient).toHaveBeenCalledTimes(1);
  });
});
