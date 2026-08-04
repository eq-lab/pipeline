/**
 * Unit tests for the T-Bills swap-form view-model (`-cash-management-tbills.ts`,
 * issue #944). The two data hooks are mocked (their module graph reaches the
 * on-chain readers); this exercises the pure helper + the buy/sell balance
 * mapping.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("@/api/useCapitalWalletBalance", () => ({
  useCapitalWalletBalance: vi.fn(),
}));
vi.mock("@/api/useCapitalAllocation", () => ({
  useCapitalAllocation: vi.fn(),
}));

import { useCapitalWalletBalance } from "@/api/useCapitalWalletBalance";
import { useCapitalAllocation } from "@/api/useCapitalAllocation";
import { formatSwapAmount, useTbillsSwap } from "./-cash-management-tbills";

const mockBalance = vi.mocked(useCapitalWalletBalance);
const mockAllocation = vi.mocked(useCapitalAllocation);

function allocation(tbills: string | null) {
  return {
    data: {
      total: null,
      buckets: {
        capital_wallet: null,
        in_transit: null,
        withdrawal_queue: null,
        trust_account: null,
        deployed: null,
        tbills,
      },
    },
    isLoading: false,
    error: null,
    refetch: () => {},
  };
}

beforeEach(() => {
  mockBalance.mockReset();
  mockAllocation.mockReset();
});

describe("formatSwapAmount", () => {
  it("adds thousands separators", () => {
    expect(formatSwapAmount(8400000)).toBe("8,400,000");
    expect(formatSwapAmount(1234.5)).toBe("1,234.5");
  });

  it('returns "—" for null / non-finite (never fabricated)', () => {
    expect(formatSwapAmount(null)).toBe("—");
    expect(formatSwapAmount(undefined)).toBe("—");
    expect(formatSwapAmount(NaN)).toBe("—");
  });
});

describe("useTbillsSwap", () => {
  it("maps the on-chain USDC balance (Buy) and the tbills bucket (Sell)", () => {
    mockBalance.mockReturnValue({
      data: "8400000.0000000",
      isLoading: false,
      error: null,
    });
    mockAllocation.mockReturnValue(allocation("500000.000000"));

    const { result } = renderHook(() => useTbillsSwap());
    expect(result.current.usdcValue).toBe(8_400_000);
    expect(result.current.usdcDisplay).toBe("8,400,000");
    expect(result.current.tbillsValue).toBe(500_000);
    expect(result.current.tbillsDisplay).toBe("500,000");
  });

  it('shows "—" for the T-Bills value while buckets.tbills is null (#931)', () => {
    mockBalance.mockReturnValue({
      data: "8400000.0000000",
      isLoading: false,
      error: null,
    });
    mockAllocation.mockReturnValue(allocation(null));

    const { result } = renderHook(() => useTbillsSwap());
    expect(result.current.tbillsValue).toBeNull();
    expect(result.current.tbillsDisplay).toBe("—");
  });

  it('shows "—" for USDC when the balance is unavailable (on-chain read error)', () => {
    mockBalance.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    });
    mockAllocation.mockReturnValue(allocation(null));

    const { result } = renderHook(() => useTbillsSwap());
    expect(result.current.usdcValue).toBeNull();
    expect(result.current.usdcDisplay).toBe("—");
  });
});
