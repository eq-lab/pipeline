// spec: docs/product-specs/withdrawals.md#bank-wire-withdrawals-lp-app
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const h = vi.hoisted(() => ({
  configured: true,
  stellarWireOuts: vi.fn(),
  evmWireOuts: vi.fn(),
  stellarPaused: vi.fn(),
  evmPaused: vi.fn(),
}));

vi.mock("./wireOutConfig", () => ({
  isWireOutMinterConfigured: () => h.configured,
}));
vi.mock("./stellar/useStellarMinterReads", () => ({
  useStellarWireOuts: (...a: unknown[]) => h.stellarWireOuts(...a),
  useStellarMinterPaused: (...a: unknown[]) => h.stellarPaused(...a),
}));
vi.mock("./evm/useEvmMinterReads", () => ({
  useEvmWireOuts: (...a: unknown[]) => h.evmWireOuts(...a),
  useEvmMinterPaused: (...a: unknown[]) => h.evmPaused(...a),
}));

import { useMinterPaused, useWireOuts } from "./useWireOutReads";

beforeEach(() => {
  vi.clearAllMocks();
  h.configured = true;
  h.stellarWireOuts.mockReturnValue({});
  h.evmWireOuts.mockReturnValue({});
  h.stellarPaused.mockReturnValue(undefined);
  h.evmPaused.mockReturnValue(undefined);
});

describe("useWireOuts", () => {
  it("enables only the active kind", () => {
    renderHook(() => useWireOuts("stellar", ["1"]));
    expect(h.stellarWireOuts).toHaveBeenCalledWith(["1"], { enabled: true });
    expect(h.evmWireOuts).toHaveBeenCalledWith(["1"], { enabled: false });
  });

  it("passes Stellar values through untouched and isolates per-id errors", () => {
    const boom = new Error("nope");
    h.stellarWireOuts.mockReturnValue({
      "1": {
        data: { amount: "12500000", status: "Settled" },
        error: null,
      },
      "2": { data: undefined, error: boom },
    });
    const { result } = renderHook(() => useWireOuts("stellar", ["1", "2"]));
    expect(result.current["1"]).toEqual({
      amountRaw: "12500000",
      status: "Settled",
      error: undefined,
    });
    expect(result.current["2"]?.error).toBe(boom);
    expect(result.current["2"]?.status).toBeUndefined();
  });

  it("passes EVM values through", () => {
    h.evmWireOuts.mockReturnValue({
      "4": { amountRaw: "5", status: "Cancelled", error: null },
    });
    const { result } = renderHook(() => useWireOuts("evm", ["4"]));
    expect(result.current["4"]).toEqual({
      amountRaw: "5",
      status: "Cancelled",
      error: undefined,
    });
    expect(h.evmWireOuts).toHaveBeenCalledWith(["4"], { enabled: true });
  });

  it("disables both chains when the minter is unconfigured", () => {
    h.configured = false;
    renderHook(() => useWireOuts("evm", ["4"]));
    expect(h.evmWireOuts).toHaveBeenCalledWith(["4"], { enabled: false });
  });
});

describe("useMinterPaused", () => {
  it("returns the active kind's value", () => {
    h.stellarPaused.mockReturnValue(true);
    h.evmPaused.mockReturnValue(false);
    expect(renderHook(() => useMinterPaused("stellar")).result.current).toBe(
      true,
    );
    expect(renderHook(() => useMinterPaused("evm")).result.current).toBe(false);
  });
});
