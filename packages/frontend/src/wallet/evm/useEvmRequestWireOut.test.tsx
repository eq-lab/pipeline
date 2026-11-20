// spec: docs/product-specs/withdrawals.md#bank-wire-withdrawals-lp-app
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import { minterWireOutAbi } from "@pipeline/wallet-connect";

const h = vi.hoisted(() => ({
  MINTER: "0x2222222222222222222222222222222222222222" as `0x${string}`,
  LP: "0x1111111111111111111111111111111111111111" as `0x${string}`,
  writeContract: vi.fn(),
  write: {
    data: undefined as string | undefined,
    isPending: false,
    error: null as Error | null,
  },
  receipt: {
    data: undefined as unknown,
    isLoading: false,
    isSuccess: false,
    error: null as Error | null,
  },
  simulate: vi.fn(),
  estimate: vi.fn(),
}));

vi.mock("wagmi", () => ({
  usePublicClient: () => ({}),
  useWriteContract: () => ({
    writeContract: h.writeContract,
    reset: vi.fn(),
    ...h.write,
  }),
  useWaitForTransactionReceipt: () => h.receipt,
}));
vi.mock("@/lib/env", () => ({
  ENV: { EVM_MINTER_ADDRESS: h.MINTER, EVM_CHAIN_ID: 560048 },
}));
vi.mock("./useEvmWallet", () => ({
  useEvmWallet: () => ({ address: h.LP, isConnected: true }),
}));
vi.mock("./simulate", () => ({
  simulateOrFail: (...a: unknown[]) => h.simulate(...a),
}));
vi.mock("./estimateGas", () => ({
  estimateGasCapped: (...a: unknown[]) => h.estimate(...a),
}));

import { useEvmRequestWireOut } from "./useEvmRequestWireOut";

const { MINTER, LP } = h;

beforeEach(() => {
  vi.clearAllMocks();
  h.write = { data: undefined, isPending: false, error: null };
  h.receipt = {
    data: undefined,
    isLoading: false,
    isSuccess: false,
    error: null,
  };
  h.simulate.mockResolvedValue({ ok: true });
  h.estimate.mockResolvedValue({ ok: true, gas: 100n });
});

describe("useEvmRequestWireOut", () => {
  it("simulates, estimates, then writes requestWireOut(amount)", async () => {
    const { result } = renderHook(() => useEvmRequestWireOut());
    act(() => result.current.request(25n));
    await waitFor(() => expect(h.writeContract).toHaveBeenCalled());
    expect(h.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: MINTER,
        functionName: "requestWireOut",
        args: [25n],
        gas: 100n,
      }),
    );
  });

  it("surfaces a simulation revert and never writes", async () => {
    h.simulate.mockResolvedValue({
      ok: false,
      error: new Error("EnforcedPause()"),
    });
    const { result } = renderHook(() => useEvmRequestWireOut());
    act(() => result.current.request(25n));
    await waitFor(() =>
      expect(result.current.error?.message).toBe("EnforcedPause()"),
    );
    expect(h.writeContract).not.toHaveBeenCalled();
  });

  it("decodes the id from the WireOutRequested log once mined", () => {
    const topics = encodeEventTopics({
      abi: minterWireOutAbi,
      eventName: "WireOutRequested",
      args: { id: 12n, lp: LP },
    });
    h.write.data = "0xhash";
    h.receipt = {
      data: {
        logs: [
          {
            address: MINTER,
            topics,
            data: encodeAbiParameters([{ type: "uint256" }], [5n]),
            blockNumber: 1n,
            blockHash: "0x",
            logIndex: 0,
            transactionHash: "0xhash",
            transactionIndex: 0,
            removed: false,
          },
        ],
      },
      isLoading: false,
      isSuccess: true,
      error: null,
    };
    const { result } = renderHook(() => useEvmRequestWireOut());
    expect(result.current.isSuccess).toBe(true);
    expect(result.current.wireOutId).toBe("12");
  });
});
