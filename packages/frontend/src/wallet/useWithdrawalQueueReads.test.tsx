// spec: docs/frontend/wallet-flows.md#withdrawal-queue-reads
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const { stellarTotals, stellarState, evmTotals, evmState } = vi.hoisted(() => ({
  stellarTotals: vi.fn(),
  stellarState: vi.fn(),
  evmTotals: vi.fn(),
  evmState: vi.fn(),
}));

vi.mock("./stellar/useStellarWithdrawalQueueReads", () => ({
  useStellarWithdrawalQueueTotals: stellarTotals,
  useStellarWithdrawalRequestQueueState: stellarState,
}));
vi.mock("./evm/useEvmWithdrawalQueueReads", () => ({
  useEvmWithdrawalQueueTotals: evmTotals,
  useEvmWithdrawalRequestQueueState: evmState,
}));
vi.mock("./stellar/useStellarSacToken", () => ({ SAC_DECIMALS: 7 }));

import {
  isRecoveryRateActive,
  useWithdrawalQueueTotals,
  useWithdrawalRequestQueueState,
} from "./useWithdrawalQueueReads";

beforeEach(() => {
  vi.clearAllMocks();
  stellarTotals.mockReturnValue({
    totalQueued: 10n,
    totalClaimed: 4n,
    rate: 1_000_000n,
    paused: false,
  });
  stellarState.mockReturnValue({ position: 7n, claimable: true });
  evmTotals.mockReturnValue({
    totalQueued: 20n,
    totalClaimed: 8n,
    payoutPerPlusd: 950_000n,
    paused: true,
    plusdDecimals: 6,
    usdcDecimals: 6,
  });
  evmState.mockReturnValue({ position: 9n, claimable: false });
});

describe("useWithdrawalQueueTotals", () => {
  it("enables only the Stellar hook on a Stellar view and passes values through", () => {
    const { result } = renderHook(() => useWithdrawalQueueTotals("stellar"));
    expect(stellarTotals).toHaveBeenCalledWith({ enabled: true });
    expect(evmTotals).toHaveBeenCalledWith({ enabled: false });
    expect(result.current).toEqual({
      totalQueued: 10n,
      totalClaimed: 4n,
      rateRaw: 1_000_000n,
      rateDecimals: 6,
      paused: false,
      plusdDecimals: 7,
      usdcDecimals: 7,
    });
  });

  it("enables only the EVM hook on an EVM view and maps the per-PLUSD payout to the rate", () => {
    const { result } = renderHook(() => useWithdrawalQueueTotals("evm"));
    expect(stellarTotals).toHaveBeenCalledWith({ enabled: false });
    expect(evmTotals).toHaveBeenCalledWith({ enabled: true });
    expect(result.current.rateRaw).toBe(950_000n);
    expect(result.current.rateDecimals).toBe(6);
    expect(result.current.paused).toBe(true);
  });

  it("disables both when the caller turns reads off", () => {
    renderHook(() => useWithdrawalQueueTotals("stellar", false));
    expect(stellarTotals).toHaveBeenCalledWith({ enabled: false });
    expect(evmTotals).toHaveBeenCalledWith({ enabled: false });
  });
});

describe("useWithdrawalRequestQueueState", () => {
  it("reads the active kind and renames claimable to payableNow", () => {
    const stellar = renderHook(() =>
      useWithdrawalRequestQueueState("stellar", 3n),
    );
    expect(stellarState).toHaveBeenCalledWith(3n, { enabled: true });
    expect(evmState).toHaveBeenCalledWith(3n, { enabled: false });
    expect(stellar.result.current).toEqual({ position: 7n, payableNow: true });

    const evm = renderHook(() => useWithdrawalRequestQueueState("evm", 3n));
    expect(evm.result.current).toEqual({ position: 9n, payableNow: false });
  });
});

describe("isRecoveryRateActive", () => {
  it("is false for undefined totals and unknown rate", () => {
    expect(isRecoveryRateActive(undefined)).toBe(false);
    expect(isRecoveryRateActive({ rateRaw: undefined, rateDecimals: 6 })).toBe(
      false,
    );
    expect(
      isRecoveryRateActive({ rateRaw: 1_000_000n, rateDecimals: undefined }),
    ).toBe(false);
  });

  it("is false at exactly 1 for Stellar and EVM units", () => {
    expect(isRecoveryRateActive({ rateRaw: 1_000_000n, rateDecimals: 6 })).toBe(
      false,
    );
    expect(
      isRecoveryRateActive({ rateRaw: 10n ** 18n, rateDecimals: 18 }),
    ).toBe(false);
  });

  it("is true below the unit", () => {
    expect(isRecoveryRateActive({ rateRaw: 999_999n, rateDecimals: 6 })).toBe(
      true,
    );
  });
});
