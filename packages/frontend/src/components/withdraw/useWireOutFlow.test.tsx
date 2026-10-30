// spec: docs/product-specs/withdrawals.md#bank-wire-withdrawals-lp-app
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const h = vi.hoisted(() => {
  const write = () => ({
    request: vi.fn(),
    isPending: false,
    isSuccess: false,
    error: null as Error | null,
    wireOutId: undefined as string | undefined,
    hash: undefined,
    reset: vi.fn(),
  });
  return {
    configured: true,
    paused: undefined as boolean | undefined,
    stellar: write(),
    evm: write(),
    approval: {
      allowance: undefined as bigint | undefined,
      isSufficient: vi.fn(() => false),
      approve: vi.fn(),
      isPending: false,
      error: null as Error | null,
      reset: vi.fn(),
    },
    write,
  };
});

vi.mock("@/wallet", async () => ({
  parseUnits: (await import("@/wallet/evm/units")).parseUnits,
  isWireOutMinterConfigured: () => h.configured,
  useMinterPaused: () => h.paused,
  useStellarRequestWireOut: () => h.stellar,
  useEvmRequestWireOut: () => h.evm,
  useApproval: () => h.approval,
  useDepositManagerAddresses: () => ({ plusd: "0xPLUSD" }),
}));
vi.mock("@/lib/env", () => ({
  ENV: { EVM_MINTER_ADDRESS: "0x2222222222222222222222222222222222222222" },
}));

import {
  WIRE_OUT_ABOVE_BALANCE_REASON,
  WIRE_OUT_KYB_REASON,
  WIRE_OUT_NOT_AUTHORISED_REASON,
  WIRE_OUT_PAUSED_REASON,
  WIRE_OUT_REQUEST_HINT,
  WIRE_OUT_ZERO_AMOUNT_REASON,
  useWireOutFlow,
  type UseWireOutFlowInput,
} from "./useWireOutFlow";

const base: UseWireOutFlowInput = {
  kind: "stellar",
  amountInput: "1",
  balance: 50_000_000n,
  decimals: 7,
  plusdAuthorized: true,
  kybPassed: true,
};

function run(over: Partial<UseWireOutFlowInput> = {}) {
  return renderHook(() => useWireOutFlow({ ...base, ...over })).result.current;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.configured = true;
  h.paused = undefined;
  h.stellar = h.write();
  h.evm = h.write();
  h.approval.isSufficient.mockReturnValue(false);
  h.approval.error = null;
});

describe("useWireOutFlow disabledReason", () => {
  it("is undefined when every gate passes", () => {
    const r = run();
    expect(r.disabledReason).toBeUndefined();
    expect(r.amountRaw).toBe(10_000_000n);
  });

  it("applies the priority unconfigured > KYB > paused > not authorised > amount", () => {
    h.paused = true;
    expect(
      run({ kybPassed: false, plusdAuthorized: false }).disabledReason,
    ).toBe(WIRE_OUT_KYB_REASON);
    expect(run({ plusdAuthorized: false }).disabledReason).toBe(
      WIRE_OUT_PAUSED_REASON,
    );
    h.paused = false;
    expect(
      run({ plusdAuthorized: false, amountInput: "" }).disabledReason,
    ).toBe(WIRE_OUT_NOT_AUTHORISED_REASON);
    h.configured = false;
    expect(run({ kybPassed: false }).disabledReason).toMatch(/not available/);
  });

  it("flags zero and above-balance amounts", () => {
    expect(run({ amountInput: "" }).disabledReason).toBe(
      WIRE_OUT_ZERO_AMOUNT_REASON,
    );
    const over = run({ amountInput: "6" });
    expect(over.exceedsBalance).toBe(true);
    expect(over.disabledReason).toBe(WIRE_OUT_ABOVE_BALANCE_REASON);
  });

  it("exposes blockedReason separately from the amount checks", () => {
    expect(run({ amountInput: "" }).blockedReason).toBeUndefined();
    expect(run({ kybPassed: false }).blockedReason).toBe(WIRE_OUT_KYB_REASON);
  });
});

describe("useWireOutFlow steps", () => {
  it("Stellar has the single request step with the escrow hint", () => {
    const { steps } = run();
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      label: "Request wire-out",
      hint: WIRE_OUT_REQUEST_HINT,
      disabled: false,
    });
  });

  it("EVM gates the request on the allowance", () => {
    const pending = run({ kind: "evm" }).steps;
    expect(pending.map((s) => s.label)).toEqual([
      "Allow Pipeline to use PLUSD",
      "Request wire-out",
    ]);
    expect(pending[0]?.state).toBe("idle");
    expect(pending[1]?.disabled).toBe(true);

    h.approval.isSufficient.mockReturnValue(true);
    const approved = run({ kind: "evm" }).steps;
    expect(approved[0]?.state).toBe("success");
    expect(approved[1]?.disabled).toBe(false);
  });

  it("submit calls the active chain's request with the raw amount", () => {
    run().submit();
    expect(h.stellar.request).toHaveBeenCalledWith(10_000_000n);
    h.approval.isSufficient.mockReturnValue(true);
    run({ kind: "evm", decimals: 6 }).submit();
    expect(h.evm.request).toHaveBeenCalledWith(1_000_000n);
  });

  it("maps step errors through the wireOut context", () => {
    h.stellar.error = new Error("HostError: Error(Contract, #16)");
    const step = run().steps[0];
    expect(step).toMatchObject({
      state: "error",
      errorMessage: WIRE_OUT_NOT_AUTHORISED_REASON,
    });
    expect(step?.errorDetails).toContain("#16");
  });

  it("reports the last wire-out id and success", () => {
    h.stellar.isSuccess = true;
    h.stellar.wireOutId = "3";
    const r = run();
    expect(r.isSuccess).toBe(true);
    expect(r.lastWireOutId).toBe("3");
    expect(r.steps[0]?.state).toBe("success");
  });
});
