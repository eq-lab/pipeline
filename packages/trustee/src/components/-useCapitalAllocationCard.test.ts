/**
 * Tests for `useCapitalAllocationCard` (issue #797, extended #805).
 *
 * `useCapitalAllocation` and `useCapitalWalletBalance` are both mocked so
 * this is a pure mapping-logic test — no QueryClient / network involved.
 * This is the behavioral core of issue #805's guarded total-sum + legend
 * precedence rules.
 *
 * `@pipeline/wallet-connect` is also mocked (even though this file never
 * calls it directly) because `useCapitalWalletBalance` imports it statically
 * — without this mock, `vi.spyOn`-ing `useCapitalWalletBalance` still pulls
 * in the real module graph (down to `@creit.tech/stellar-wallets-kit`'s
 * `defaultModules()` / `@stellar/freighter-api`), which can fail to resolve
 * in some sandboxes. Mirrors `-useCapitalWalletBalance.test.tsx`'s own mock.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useCapitalAllocationCard } from "./useCapitalAllocationCard";
import * as capitalAllocationModule from "@/api/useCapitalAllocation";
import * as capitalWalletBalanceModule from "@/api/useCapitalWalletBalance";
import type { UseCapitalAllocationResult } from "@/api/useCapitalAllocation";
import type { UseCapitalWalletBalanceResult } from "@/api/useCapitalWalletBalance";

vi.mock("@pipeline/wallet-connect", () => ({
  getSacBalance: vi.fn(),
}));

function mockCapitalAllocation(overrides: Partial<UseCapitalAllocationResult>) {
  const base: UseCapitalAllocationResult = {
    data: undefined,
    isLoading: false,
    error: null,
    refetch: () => {},
  };
  vi.spyOn(capitalAllocationModule, "useCapitalAllocation").mockReturnValue({
    ...base,
    ...overrides,
  });
}

function mockCapitalWalletBalance(
  overrides: Partial<UseCapitalWalletBalanceResult>,
) {
  const base: UseCapitalWalletBalanceResult = {
    data: undefined,
    isLoading: false,
    error: null,
  };
  vi.spyOn(
    capitalWalletBalanceModule,
    "useCapitalWalletBalance",
  ).mockReturnValue({ ...base, ...overrides });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useCapitalAllocationCard — Capital Wallet on-chain fold-in (#805)", () => {
  it("uses the on-chain balance as the capital_wallet legend value when the backend bucket is null", () => {
    mockCapitalAllocation({
      data: {
        total: "96000000.000000",
        buckets: {
          capital_wallet: null,
          in_transit: null,
          withdrawal_queue: null,
          trust_account: null,
          deployed: "96000000.000000",
          tbills: null,
        },
      },
    });
    mockCapitalWalletBalance({ data: "8400000.0000000" });

    const { result } = renderHook(() => useCapitalAllocationCard());

    const capitalWalletRow = result.current.legend.find(
      (row) => row.key === "capital_wallet",
    );
    expect(capitalWalletRow?.value).toBe("$8.4M");
  });

  it("prefers the backend capital_wallet bucket over the on-chain read when both are present", () => {
    mockCapitalAllocation({
      data: {
        total: "115190000.000000",
        buckets: {
          capital_wallet: "9000000.000000",
          in_transit: null,
          withdrawal_queue: null,
          trust_account: null,
          deployed: "96000000.000000",
          tbills: null,
        },
      },
    });
    mockCapitalWalletBalance({ data: "8400000.0000000" });

    const { result } = renderHook(() => useCapitalAllocationCard());

    const capitalWalletRow = result.current.legend.find(
      (row) => row.key === "capital_wallet",
    );
    // Backend value ($9M), not the on-chain value ($8.4M) — no double source.
    expect(capitalWalletRow?.value).toBe("$9M");
  });

  it("sums backend total + on-chain balance only when the backend bucket is null (double-count guard)", () => {
    mockCapitalAllocation({
      data: {
        total: "96000000.000000",
        buckets: {
          capital_wallet: null,
          in_transit: null,
          withdrawal_queue: null,
          trust_account: null,
          deployed: "96000000.000000",
          tbills: null,
        },
      },
    });
    mockCapitalWalletBalance({ data: "8400000.0000000" });

    const { result } = renderHook(() => useCapitalAllocationCard());

    expect(result.current.totalDisplay).toBe("$104,400,000");
  });

  it("does NOT add the on-chain balance when the backend bucket is already non-null", () => {
    mockCapitalAllocation({
      data: {
        total: "115190000.000000",
        buckets: {
          capital_wallet: "9000000.000000",
          in_transit: "4950000.000000",
          withdrawal_queue: null,
          trust_account: "1200000.000000",
          deployed: "96000000.000000",
          tbills: "4040000.000000",
        },
      },
    });
    mockCapitalWalletBalance({ data: "8400000.0000000" });

    const { result } = renderHook(() => useCapitalAllocationCard());

    // Unchanged backend total — NOT total + 8.4M.
    expect(result.current.totalDisplay).toBe("$115,190,000");
  });

  it("shows the on-chain balance as the sole known total when backend total is null", () => {
    mockCapitalAllocation({
      data: {
        total: null,
        buckets: {
          capital_wallet: null,
          in_transit: null,
          withdrawal_queue: null,
          trust_account: null,
          deployed: null,
          tbills: null,
        },
      },
    });
    mockCapitalWalletBalance({ data: "8400000.0000000" });

    const { result } = renderHook(() => useCapitalAllocationCard());

    expect(result.current.totalDisplay).toBe("$8,400,000");
    const capitalWalletRow = result.current.legend.find(
      (row) => row.key === "capital_wallet",
    );
    expect(capitalWalletRow?.value).toBe("$8.4M");
  });

  it('renders "—" for total when neither backend total nor the on-chain balance is known', () => {
    mockCapitalAllocation({
      data: {
        total: null,
        buckets: {
          capital_wallet: null,
          in_transit: null,
          withdrawal_queue: null,
          trust_account: null,
          deployed: null,
          tbills: null,
        },
      },
    });
    mockCapitalWalletBalance({ data: undefined });

    const { result } = renderHook(() => useCapitalAllocationCard());

    expect(result.current.totalDisplay).toBe("—");
  });

  it('degrades only the capital_wallet legend value to "—" on an on-chain read error, without setting the card error', () => {
    mockCapitalAllocation({
      data: {
        total: "96000000.000000",
        buckets: {
          capital_wallet: null,
          in_transit: null,
          withdrawal_queue: null,
          trust_account: null,
          deployed: "96000000.000000",
          tbills: null,
        },
      },
    });
    mockCapitalWalletBalance({
      data: undefined,
      error: new Error("sentinel"),
    });

    const { result } = renderHook(() => useCapitalAllocationCard());

    const capitalWalletRow = result.current.legend.find(
      (row) => row.key === "capital_wallet",
    );
    expect(capitalWalletRow?.value).toBe("—");
    // Backend total unaffected by the on-chain error — no addend, no card error.
    expect(result.current.totalDisplay).toBe("$96,000,000");
    expect(result.current.isError).toBe(false);
  });

  it("keeps the card rendering (isLoading false) when only the on-chain read is loading", () => {
    mockCapitalAllocation({
      data: {
        total: "96000000.000000",
        buckets: {
          capital_wallet: null,
          in_transit: null,
          withdrawal_queue: null,
          trust_account: null,
          deployed: "96000000.000000",
          tbills: null,
        },
      },
      isLoading: false,
    });
    mockCapitalWalletBalance({ data: undefined, isLoading: true });

    const { result } = renderHook(() => useCapitalAllocationCard());

    expect(result.current.isLoading).toBe(false);
    const capitalWalletRow = result.current.legend.find(
      (row) => row.key === "capital_wallet",
    );
    expect(capitalWalletRow?.value).toBe("—");
  });
});

describe("useCapitalAllocationCard — per-bucket percentage pills (#805 scope addition, Figma 4116:8961)", () => {
  function percentOf(
    legend: ReturnType<typeof useCapitalAllocationCard>["legend"],
    key: string,
  ) {
    return legend.find((row) => row.key === key)?.percentDisplay;
  }

  it("computes bucket_value ÷ displayed_total rounded to the nearest whole percent for every populated bucket", () => {
    // Matches the Figma reference exactly (7% / 4% / 1% / 83% / 4%, total
    // 115,190,000) — deliberately does NOT sum to 100 (99), matching Figma.
    mockCapitalAllocation({
      data: {
        total: "115190000.000000",
        buckets: {
          capital_wallet: "8400000.000000",
          in_transit: "4950000.000000",
          withdrawal_queue: null,
          trust_account: "1200000.000000",
          deployed: "96000000.000000",
          tbills: "4640000.000000",
        },
      },
    });
    mockCapitalWalletBalance({ data: undefined });

    const { result } = renderHook(() => useCapitalAllocationCard());

    expect(percentOf(result.current.legend, "capital_wallet")).toBe("7%");
    expect(percentOf(result.current.legend, "in_transit")).toBe("4%");
    expect(percentOf(result.current.legend, "trust_account")).toBe("1%");
    expect(percentOf(result.current.legend, "deployed")).toBe("83%");
    expect(percentOf(result.current.legend, "tbills")).toBe("4%");
  });

  it("renders the served withdrawal_queue bucket with value, percent, and bar fraction (#1020)", () => {
    // Mirrors the live stage response that exposed the gap: total $15.2M =
    // deployed $5.2M + withdrawal_queue $10M; no on-chain wallet read.
    mockCapitalAllocation({
      data: {
        total: "15200000.000000",
        buckets: {
          capital_wallet: null,
          in_transit: "0.000000",
          withdrawal_queue: "10000000.000000",
          trust_account: "0.000000",
          deployed: "5200000.000000",
          tbills: null,
        },
      },
    });
    mockCapitalWalletBalance({ data: undefined });

    const { result } = renderHook(() => useCapitalAllocationCard());

    const row = result.current.legend.find((r) => r.key === "withdrawal_queue");
    expect(row?.label).toBe("Withdrawal queue");
    expect(row?.value).toBe("$10M");
    expect(row?.percentDisplay).toBe("66%");
    expect(row?.barFraction).toBeCloseTo(10_000_000 / 15_200_000, 10);
    // The legend keeps the null-bucket behavior for the others.
    expect(result.current.legend).toHaveLength(6);
  });

  it("renders '—' and no percent/segment for a null withdrawal_queue (#1020)", () => {
    mockCapitalAllocation({
      data: {
        total: "5200000.000000",
        buckets: {
          capital_wallet: null,
          in_transit: null,
          withdrawal_queue: null,
          trust_account: null,
          deployed: "5200000.000000",
          tbills: null,
        },
      },
    });
    mockCapitalWalletBalance({ data: undefined });

    const { result } = renderHook(() => useCapitalAllocationCard());

    const row = result.current.legend.find((r) => r.key === "withdrawal_queue");
    expect(row?.value).toBe("—");
    expect(row?.percentDisplay).toBeNull();
    expect(row?.barFraction).toBeNull();
  });

  it("computes the capital_wallet percentage against the on-chain-augmented total (double-count guard scenario)", () => {
    mockCapitalAllocation({
      data: {
        total: "96000000.000000",
        buckets: {
          capital_wallet: null,
          in_transit: null,
          withdrawal_queue: null,
          trust_account: null,
          deployed: "96000000.000000",
          tbills: null,
        },
      },
    });
    mockCapitalWalletBalance({ data: "8400000.0000000" });

    const { result } = renderHook(() => useCapitalAllocationCard());

    // Total = 96M + 8.4M = 104.4M. capital_wallet = 8.4M / 104.4M ≈ 8%.
    expect(percentOf(result.current.legend, "capital_wallet")).toBe("8%");
    expect(percentOf(result.current.legend, "deployed")).toBe("92%");
  });

  it('renders no percentage (never a fabricated "0%") for a null bucket', () => {
    mockCapitalAllocation({
      data: {
        total: "96000000.000000",
        buckets: {
          capital_wallet: null,
          in_transit: null,
          withdrawal_queue: null,
          trust_account: null,
          deployed: "96000000.000000",
          tbills: null,
        },
      },
    });
    mockCapitalWalletBalance({ data: undefined });

    const { result } = renderHook(() => useCapitalAllocationCard());

    expect(percentOf(result.current.legend, "capital_wallet")).toBeNull();
    expect(percentOf(result.current.legend, "in_transit")).toBeNull();
    expect(percentOf(result.current.legend, "trust_account")).toBeNull();
    expect(percentOf(result.current.legend, "tbills")).toBeNull();
    // The only known bucket still gets a real percentage.
    expect(percentOf(result.current.legend, "deployed")).toBe("100%");
  });

  it("renders no percentage for any bucket when the total is unknown", () => {
    mockCapitalAllocation({
      data: {
        total: null,
        buckets: {
          capital_wallet: null,
          in_transit: null,
          withdrawal_queue: null,
          trust_account: null,
          deployed: null,
          tbills: null,
        },
      },
    });
    mockCapitalWalletBalance({ data: undefined });

    const { result } = renderHook(() => useCapitalAllocationCard());

    result.current.legend.forEach((row) => {
      expect(row.percentDisplay).toBeNull();
    });
  });

  it('renders "< 1%" for a strictly-positive sub-1%-share bucket (PR #811 review follow-up)', () => {
    // tbills = 500,000 / 100,500,000 ≈ 0.4975% — must NOT round to "0%" or "1%".
    mockCapitalAllocation({
      data: {
        total: "100500000.000000",
        buckets: {
          capital_wallet: null,
          in_transit: null,
          withdrawal_queue: null,
          trust_account: null,
          deployed: "100000000.000000",
          tbills: "500000.000000",
        },
      },
    });
    mockCapitalWalletBalance({ data: undefined });

    const { result } = renderHook(() => useCapitalAllocationCard());

    expect(percentOf(result.current.legend, "tbills")).toBe("< 1%");
    // 100,000,000 / 100,500,000 ≈ 99.5% → rounds to 100% (independent
    // per-bucket rounding, deliberately not normalized to sum to 100).
    expect(percentOf(result.current.legend, "deployed")).toBe("100%");
  });

  it('renders "< 1%" exactly at a share just under 1%, and "1%" once the share reaches 1%', () => {
    // in_transit = 999,999 / 100,000,000 ≈ 0.999999% → "< 1%".
    mockCapitalAllocation({
      data: {
        total: "100000000.000000",
        buckets: {
          capital_wallet: null,
          in_transit: "999999.000000",
          withdrawal_queue: null,
          trust_account: null,
          deployed: null,
          tbills: null,
        },
      },
    });
    mockCapitalWalletBalance({ data: undefined });

    const { result: justUnder } = renderHook(() => useCapitalAllocationCard());
    expect(percentOf(justUnder.current.legend, "in_transit")).toBe("< 1%");

    // trust_account = 1,000,000 / 100,000,000 = exactly 1% → "1%", not "< 1%".
    mockCapitalAllocation({
      data: {
        total: "100000000.000000",
        buckets: {
          capital_wallet: null,
          in_transit: null,
          withdrawal_queue: null,
          trust_account: "1000000.000000",
          deployed: null,
          tbills: null,
        },
      },
    });
    mockCapitalWalletBalance({ data: undefined });

    const { result: atOnePercent } = renderHook(() =>
      useCapitalAllocationCard(),
    );
    expect(percentOf(atOnePercent.current.legend, "trust_account")).toBe("1%");
  });
});

describe("useCapitalAllocationCard — proportional allocation bar (barFraction, PR #811 review follow-up)", () => {
  function barFractionOf(
    legend: ReturnType<typeof useCapitalAllocationCard>["legend"],
    key: string,
  ) {
    return legend.find((row) => row.key === key)?.barFraction;
  }

  it("computes the exact (unrounded) fraction of the total for every populated bucket", () => {
    mockCapitalAllocation({
      data: {
        total: "115190000.000000",
        buckets: {
          capital_wallet: "8400000.000000",
          in_transit: "4950000.000000",
          withdrawal_queue: null,
          trust_account: "1200000.000000",
          deployed: "96000000.000000",
          tbills: "4640000.000000",
        },
      },
    });
    mockCapitalWalletBalance({ data: undefined });

    const { result } = renderHook(() => useCapitalAllocationCard());

    const total = 115_190_000;
    expect(barFractionOf(result.current.legend, "capital_wallet")).toBeCloseTo(
      8_400_000 / total,
    );
    expect(barFractionOf(result.current.legend, "deployed")).toBeCloseTo(
      96_000_000 / total,
    );
    // The largest bucket (deployed) has the largest fraction.
    const deployedFraction = barFractionOf(result.current.legend, "deployed");
    const capitalWalletFraction = barFractionOf(
      result.current.legend,
      "capital_wallet",
    );
    expect(deployedFraction).toBeGreaterThan(capitalWalletFraction as number);
  });

  it("sets barFraction to null for a null/unknown bucket, even when other buckets are known", () => {
    mockCapitalAllocation({
      data: {
        total: "96000000.000000",
        buckets: {
          capital_wallet: null,
          in_transit: null,
          withdrawal_queue: null,
          trust_account: null,
          deployed: "96000000.000000",
          tbills: null,
        },
      },
    });
    mockCapitalWalletBalance({ data: undefined });

    const { result } = renderHook(() => useCapitalAllocationCard());

    expect(barFractionOf(result.current.legend, "capital_wallet")).toBeNull();
    expect(barFractionOf(result.current.legend, "in_transit")).toBeNull();
    expect(barFractionOf(result.current.legend, "trust_account")).toBeNull();
    expect(barFractionOf(result.current.legend, "tbills")).toBeNull();
    expect(barFractionOf(result.current.legend, "deployed")).toBe(1);
  });

  it("sets barFraction to null for every bucket when the total is unknown", () => {
    mockCapitalAllocation({
      data: {
        total: null,
        buckets: {
          capital_wallet: null,
          in_transit: null,
          withdrawal_queue: null,
          trust_account: null,
          deployed: null,
          tbills: null,
        },
      },
    });
    mockCapitalWalletBalance({ data: undefined });

    const { result } = renderHook(() => useCapitalAllocationCard());

    result.current.legend.forEach((row) => {
      expect(row.barFraction).toBeNull();
    });
  });

  it("still computes a (thin) barFraction for a sub-1%-percentDisplay bucket — the bar segment is not suppressed", () => {
    mockCapitalAllocation({
      data: {
        total: "100500000.000000",
        buckets: {
          capital_wallet: null,
          in_transit: null,
          withdrawal_queue: null,
          trust_account: null,
          deployed: "100000000.000000",
          tbills: "500000.000000",
        },
      },
    });
    mockCapitalWalletBalance({ data: undefined });

    const { result } = renderHook(() => useCapitalAllocationCard());

    const tbillsRow = result.current.legend.find((row) => row.key === "tbills");
    expect(tbillsRow?.percentDisplay).toBe("< 1%");
    expect(tbillsRow?.barFraction).toBeCloseTo(500_000 / 100_500_000);
    expect(tbillsRow?.barFraction).toBeGreaterThan(0);
  });

  it("computes the capital_wallet barFraction against the on-chain-augmented total (double-count guard scenario)", () => {
    mockCapitalAllocation({
      data: {
        total: "96000000.000000",
        buckets: {
          capital_wallet: null,
          in_transit: null,
          withdrawal_queue: null,
          trust_account: null,
          deployed: "96000000.000000",
          tbills: null,
        },
      },
    });
    mockCapitalWalletBalance({ data: "8400000.0000000" });

    const { result } = renderHook(() => useCapitalAllocationCard());

    // Total = 96M + 8.4M = 104.4M.
    expect(barFractionOf(result.current.legend, "capital_wallet")).toBeCloseTo(
      8_400_000 / 104_400_000,
    );
    expect(barFractionOf(result.current.legend, "deployed")).toBeCloseTo(
      96_000_000 / 104_400_000,
    );
  });
});
