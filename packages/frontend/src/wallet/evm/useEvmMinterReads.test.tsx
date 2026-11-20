// spec: docs/product-specs/withdrawals.md#bank-wire-withdrawals-lp-app
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const h = vi.hoisted(() => ({
  MINTER: "0x2222222222222222222222222222222222222222",
  contracts: vi.fn(),
  contract: vi.fn(),
  env: { EVM_MINTER_ADDRESS: "0x2222222222222222222222222222222222222222" },
}));

vi.mock("wagmi", () => ({
  useReadContracts: (...a: unknown[]) => h.contracts(...a),
  useReadContract: (...a: unknown[]) => h.contract(...a),
}));
vi.mock("@/lib/env", () => ({ ENV: h.env }));

import { useEvmMinterPaused, useEvmWireOuts } from "./useEvmMinterReads";

const LP = "0x1111111111111111111111111111111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  h.env.EVM_MINTER_ADDRESS = h.MINTER;
});

describe("useEvmWireOuts", () => {
  it("maps status indices and passes amounts through untouched", () => {
    h.contracts.mockReturnValue({
      data: [
        { status: "success", result: { lp: LP, status: 0, amount: 5n } },
        { status: "success", result: { lp: LP, status: 1, amount: 6n } },
        { status: "success", result: { lp: LP, status: 2, amount: 7n } },
        { status: "failure", error: new Error("MinterNonExistentWireOut") },
      ],
    });
    const { result } = renderHook(() => useEvmWireOuts(["1", "2", "3", "4"]));
    expect(result.current["1"]).toMatchObject({
      amountRaw: "5",
      status: "Pending",
    });
    expect(result.current["2"]).toMatchObject({
      amountRaw: "6",
      status: "Settled",
    });
    expect(result.current["3"]).toMatchObject({
      amountRaw: "7",
      status: "Cancelled",
    });
    expect(result.current["4"]?.error?.message).toBe(
      "MinterNonExistentWireOut",
    );
    expect(result.current["4"]?.status).toBeUndefined();
  });

  it("builds one wireOut call per id and stops polling when all are terminal", () => {
    h.contracts.mockReturnValue({ data: undefined });
    renderHook(() => useEvmWireOuts(["1", "2"]));
    const args = h.contracts.mock.calls[0]?.[0];
    expect(args.contracts).toHaveLength(2);
    expect(args.contracts[1]).toMatchObject({
      functionName: "wireOut",
      args: [2n],
    });
    const interval = args.query.refetchInterval;
    const terminal = { state: { data: [{ result: { status: 1 } }] } };
    const pending = { state: { data: [{ result: { status: 0 } }] } };
    expect(interval(terminal)).toBe(false);
    expect(interval(pending)).toBe(30_000);
  });

  it("is disabled when the minter is the zero address", () => {
    h.env.EVM_MINTER_ADDRESS = "0x0000000000000000000000000000000000000000";
    h.contracts.mockReturnValue({ data: undefined });
    renderHook(() => useEvmWireOuts(["1"]));
    expect(h.contracts.mock.calls[0]?.[0].query.enabled).toBe(false);
  });
});

describe("useEvmMinterPaused", () => {
  it("returns the read value", () => {
    h.contract.mockReturnValue({ data: true });
    expect(renderHook(() => useEvmMinterPaused()).result.current).toBe(true);
  });
});
