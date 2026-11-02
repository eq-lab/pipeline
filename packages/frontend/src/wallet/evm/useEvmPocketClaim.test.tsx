// spec: docs/product-specs/staking.md#default-pockets
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  POCKET: "0x3333333333333333333333333333333333333333" as `0x${string}`,
  HOLDER: "0x1111111111111111111111111111111111111111" as `0x${string}`,
  writeContract: vi.fn(),
  write: {
    data: undefined as string | undefined,
    isPending: false,
    error: null as Error | null,
  },
  receipt: { isLoading: false, isSuccess: false, error: null as Error | null },
  wallet: { address: undefined as string | undefined, isConnected: true },
  env: { EVM_POCKET_ADDRESS: "", EVM_CHAIN_ID: 560048 },
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
vi.mock("@/lib/env", () => ({ ENV: h.env }));
vi.mock("./useEvmWallet", () => ({ useEvmWallet: () => h.wallet }));
vi.mock("./simulate", () => ({
  simulateOrFail: (...a: unknown[]) => h.simulate(...a),
}));
vi.mock("./estimateGas", () => ({
  estimateGasCapped: (...a: unknown[]) => h.estimate(...a),
}));

import { useEvmPocketClaim } from "./useEvmPocketClaim";

beforeEach(() => {
  vi.clearAllMocks();
  h.env.EVM_POCKET_ADDRESS = h.POCKET;
  h.wallet = { address: h.HOLDER, isConnected: true };
  h.write = { data: undefined, isPending: false, error: null };
  h.receipt = { isLoading: false, isSuccess: false, error: null };
  h.simulate.mockResolvedValue({ ok: true });
  h.estimate.mockResolvedValue({ ok: true, gas: 100n });
});

describe("useEvmPocketClaim", () => {
  it("simulates, estimates, then writes claim(holder, loanId)", async () => {
    const { result } = renderHook(() => useEvmPocketClaim());
    act(() => result.current.claim("7"));
    await waitFor(() => expect(h.writeContract).toHaveBeenCalled());
    expect(h.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: h.POCKET,
        functionName: "claim",
        args: [h.HOLDER, 7n],
        gas: 100n,
        chainId: 560048,
      }),
    );
    expect(result.current.loanId).toBe("7");
  });

  it("surfaces a simulation revert and never writes", async () => {
    h.simulate.mockResolvedValue({
      ok: false,
      error: new Error("NothingToClaim()"),
    });
    const { result } = renderHook(() => useEvmPocketClaim());
    act(() => result.current.claim("7"));
    await waitFor(() =>
      expect(result.current.error?.message).toBe("NothingToClaim()"),
    );
    expect(h.writeContract).not.toHaveBeenCalled();
  });

  it("errors when unconfigured or not connected", () => {
    h.env.EVM_POCKET_ADDRESS = "0x0000000000000000000000000000000000000000";
    const a = renderHook(() => useEvmPocketClaim());
    act(() => a.result.current.claim("1"));
    expect(a.result.current.error?.message).toMatch(/not configured/);
    h.env.EVM_POCKET_ADDRESS = h.POCKET;
    h.wallet = { address: undefined, isConnected: false };
    const b = renderHook(() => useEvmPocketClaim());
    act(() => b.result.current.claim("1"));
    expect(b.result.current.error?.message).toMatch(/not connected/);
    expect(h.writeContract).not.toHaveBeenCalled();
  });

  it("reports success from the receipt", () => {
    h.write.data = "0xhash";
    h.receipt = { isLoading: false, isSuccess: true, error: null };
    const { result } = renderHook(() => useEvmPocketClaim());
    expect(result.current.isSuccess).toBe(true);
    expect(result.current.amountRaw).toBeUndefined();
  });
});
