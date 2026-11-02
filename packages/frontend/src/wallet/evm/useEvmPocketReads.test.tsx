// spec: docs/product-specs/staking.md#default-pockets
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { ContractFunctionRevertedError } from "viem";
import { pocketAbi } from "@pipeline/wallet-connect";

const h = vi.hoisted(() => ({
  POCKET: "0x3333333333333333333333333333333333333333",
  contracts: vi.fn(),
  env: { EVM_POCKET_ADDRESS: "0x3333333333333333333333333333333333333333" },
}));

vi.mock("wagmi", () => ({
  useReadContracts: (...a: unknown[]) => h.contracts(...a),
}));
vi.mock("@/lib/env", () => ({ ENV: h.env }));

import { useEvmPocketReads } from "./useEvmPocketReads";

const HOLDER = "0x1111111111111111111111111111111111111111";

function revertError() {
  const cause = new ContractFunctionRevertedError({
    abi: pocketAbi,
    functionName: "pocket",
  });
  return { walk: (fn: (e: unknown) => boolean) => (fn(cause) ? cause : null) };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.env.EVM_POCKET_ADDRESS = h.POCKET;
});

describe("useEvmPocketReads", () => {
  it("builds three calls per loan and passes raw values through", () => {
    h.contracts.mockReturnValue({
      data: [
        { status: "success", result: { balance: 9n } },
        { status: "success", result: 4n },
        { status: "success", result: 0n },
      ],
    });
    const { result } = renderHook(() => useEvmPocketReads(["7"], HOLDER));
    const args = h.contracts.mock.calls[0]?.[0];
    expect(args.contracts).toHaveLength(3);
    expect(args.contracts[1]).toMatchObject({
      functionName: "claimable",
      args: [HOLDER, 7n],
    });
    expect(result.current["7"]).toEqual({
      exists: true,
      balanceRaw: "9",
      claimableRaw: "4",
      claimedRaw: "0",
      error: null,
    });
  });

  it("treats a revert on pocket(loan_id) as an absent pocket", () => {
    h.contracts.mockReturnValue({
      data: [
        { status: "failure", error: revertError() },
        { status: "failure", error: revertError() },
        { status: "failure", error: revertError() },
      ],
    });
    const { result } = renderHook(() => useEvmPocketReads(["8"], HOLDER));
    expect(result.current["8"]?.exists).toBe(false);
    expect(result.current["8"]?.error).toBeNull();
  });

  it("surfaces a non-revert failure as an error with unknown existence", () => {
    h.contracts.mockReturnValue({
      data: [
        { status: "failure", error: new Error("network") },
        { status: "failure", error: new Error("network") },
        { status: "failure", error: new Error("network") },
      ],
    });
    const { result } = renderHook(() => useEvmPocketReads(["9"], HOLDER));
    expect(result.current["9"]?.exists).toBeUndefined();
    expect(result.current["9"]?.error?.message).toBe("network");
  });

  it("is disabled when unconfigured or switched off", () => {
    h.contracts.mockReturnValue({ data: undefined });
    h.env.EVM_POCKET_ADDRESS = "0x0000000000000000000000000000000000000000";
    renderHook(() => useEvmPocketReads(["1"], HOLDER));
    expect(h.contracts.mock.calls[0]?.[0].query.enabled).toBe(false);
    h.env.EVM_POCKET_ADDRESS = h.POCKET;
    renderHook(() => useEvmPocketReads(["1"], HOLDER, { enabled: false }));
    expect(h.contracts.mock.calls[1]?.[0].query.enabled).toBe(false);
  });
});
