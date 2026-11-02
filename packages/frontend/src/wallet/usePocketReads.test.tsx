// spec: docs/product-specs/staking.md#default-pockets
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const h = vi.hoisted(() => ({
  configured: true,
  stellar: vi.fn(),
  evm: vi.fn(),
}));

vi.mock("./pocketConfig", () => ({ isPocketConfigured: () => h.configured }));
vi.mock("./stellar/useStellarPocketReads", () => ({
  useStellarPocketReads: (...a: unknown[]) => h.stellar(...a),
}));
vi.mock("./evm/useEvmPocketReads", () => ({
  useEvmPocketReads: (...a: unknown[]) => h.evm(...a),
}));

import { usePocketReads } from "./usePocketReads";

beforeEach(() => {
  vi.clearAllMocks();
  h.configured = true;
  h.stellar.mockReturnValue({});
  h.evm.mockReturnValue({});
});

describe("usePocketReads", () => {
  it("enables only the active kind", () => {
    renderHook(() => usePocketReads("evm", ["1"], "0xabc"));
    expect(h.evm).toHaveBeenCalledWith(["1"], "0xabc", { enabled: true });
    expect(h.stellar).toHaveBeenCalledWith(["1"], "0xabc", { enabled: false });
  });

  it("disables both when the pocket is not configured", () => {
    h.configured = false;
    renderHook(() => usePocketReads("stellar", ["1"], "G"));
    expect(h.stellar).toHaveBeenCalledWith(["1"], "G", { enabled: false });
  });

  it("passes raw values through and isolates per-loan errors", () => {
    const boom = new Error("nope");
    h.stellar.mockReturnValue({
      "1": {
        exists: true,
        balanceRaw: "10",
        claimableRaw: "3",
        claimedRaw: "0",
        error: null,
      },
      "2": {
        exists: undefined,
        balanceRaw: undefined,
        claimableRaw: undefined,
        claimedRaw: undefined,
        error: boom,
      },
    });
    const { result } = renderHook(() =>
      usePocketReads("stellar", ["1", "2"], "G"),
    );
    expect(result.current["1"]).toEqual({
      exists: true,
      balanceRaw: "10",
      claimableRaw: "3",
      claimedRaw: "0",
      error: undefined,
    });
    expect(result.current["2"]?.error).toBe(boom);
  });
});
