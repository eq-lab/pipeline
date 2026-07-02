/**
 * Tests for `useBalanceSheetPanel`.
 *
 * Mocks all data hooks and validates the panel state machine, formatting,
 * and decimal correctness.
 *
 * Scenarios:
 *   1. Loading state — while REST is in-flight.
 *   2. Error state — when REST fails.
 *   3. Blended ready state — REST deployed/junior + Horizon USDC/PLUSD strings.
 *   4. Unconfigured Horizon reads — PLUSD + USDC rows → "—", REST rows still render.
 *   5. USYC row always renders "—".
 *   6. Off-chain USD row always renders "—".
 *   7. PLUSD outstanding has "1:1 redeemable" caption.
 *   8. String value formatting — Horizon decimal strings format to compact USD.
 *   9. Formatter edge: "0.0000000" → "$0".
 *  10. Unsourced rows → showTotalsDisclaimer = true.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useBalanceSheetPanel } from "./useBalanceSheetPanel";

// ── Controlled mock state ─────────────────────────────────────────────────────

// REST hook state
let mockRestIsLoading = false;
let mockRestError: Error | null = null;
let mockRestData: Record<string, unknown> | null = null;
const mockRestRefetch = vi.fn();

// Horizon hooks return human-decimal strings (not bigints)
let mockPlusdData: string | undefined = undefined;
let mockUsdcData: string | undefined = undefined;

vi.mock("@/api/useFinancialPosition", () => ({
  useFinancialPosition: () => ({
    data: mockRestData,
    isLoading: mockRestIsLoading,
    error: mockRestError,
    refetch: mockRestRefetch,
  }),
}));

vi.mock("@/wallet/stellar/useStellarFinancialPositionReads", () => ({
  useStellarPlusdTotalSupply: () => ({
    data: mockPlusdData,
    isLoading: false,
    error: null,
  }),
  useStellarUsdcReserveBalance: () => ({
    data: mockUsdcData,
    isLoading: false,
    error: null,
  }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const REST_FIXTURE = {
  assets: {
    total: "8100000.000000",
    liquid: {
      total: null,
      cash_stablecoins: null,
      tokenized_tbills: null,
      off_chain_usd: null,
    },
    deployed: {
      total: "8100000.000000",
      secured_loans_outstanding: "8000000.000000",
      accrued_interest_receivable: "100000.000000",
    },
  },
  liabilities: {
    total: "500000.000000",
    senior_claims: { plusd_outstanding: null },
    subordinated_capital: { junior_tranche: "500000.000000" },
  },
};

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockRestIsLoading = false;
  mockRestError = null;
  mockRestData = null;
  mockPlusdData = undefined;
  mockUsdcData = undefined;
  mockRestRefetch.mockClear();
});

// ── Tests — loading state ─────────────────────────────────────────────────────

describe("useBalanceSheetPanel — loading state", () => {
  it("returns loading when REST is in-flight", () => {
    mockRestIsLoading = true;

    const { result } = renderHook(() => useBalanceSheetPanel(), {
      wrapper: makeWrapper(),
    });

    expect(result.current.state).toBe("loading");
    expect(result.current.assets.liquid[0]?.value).toBe("—");
    expect(result.current.liabilities.seniorClaims[0]?.value).toBe("—");
  });
});

// ── Tests — error state ───────────────────────────────────────────────────────

describe("useBalanceSheetPanel — error state", () => {
  it("returns error when REST fails", () => {
    mockRestError = new Error("network failure");

    const { result } = renderHook(() => useBalanceSheetPanel(), {
      wrapper: makeWrapper(),
    });

    expect(result.current.state).toBe("error");
    expect(result.current.errorMessage).toBe("network failure");
  });

  it("exposes refetch on error", () => {
    mockRestError = new Error("oops");

    const { result } = renderHook(() => useBalanceSheetPanel(), {
      wrapper: makeWrapper(),
    });

    result.current.refetch();
    expect(mockRestRefetch).toHaveBeenCalledOnce();
  });
});

// ── Tests — ready state (blended) ────────────────────────────────────────────

describe("useBalanceSheetPanel — blended ready state", () => {
  beforeEach(() => {
    mockRestData = REST_FIXTURE;
    // Horizon returns human-decimal strings directly
    mockPlusdData = "43140000.0000000"; // 43.14M PLUSD
    mockUsdcData = "10000.0000000"; // 10K USDC
  });

  it("enters ready state", () => {
    const { result } = renderHook(() => useBalanceSheetPanel(), {
      wrapper: makeWrapper(),
    });
    expect(result.current.state).toBe("ready");
  });

  it("deployed rows render from REST", () => {
    const { result } = renderHook(() => useBalanceSheetPanel(), {
      wrapper: makeWrapper(),
    });

    const secured = result.current.assets.deployed.find(
      (r) => r.testId === "bs-secured-loans",
    );
    const accrued = result.current.assets.deployed.find(
      (r) => r.testId === "bs-accrued-interest",
    );

    expect(secured?.value).toBe("$8.0M");
    expect(accrued?.value).toBe("$100.0K");
  });

  it("PLUSD outstanding renders from Horizon total supply string (NOT —)", () => {
    const { result } = renderHook(() => useBalanceSheetPanel(), {
      wrapper: makeWrapper(),
    });

    const plusd = result.current.liabilities.seniorClaims.find(
      (r) => r.testId === "bs-plusd-outstanding",
    );

    expect(plusd?.value).not.toBe("—");
    // "43140000.0000000" → $43.1M
    expect(plusd?.value).toBe("$43.1M");
  });

  it("PLUSD outstanding has '1:1 redeemable' caption", () => {
    const { result } = renderHook(() => useBalanceSheetPanel(), {
      wrapper: makeWrapper(),
    });

    const plusd = result.current.liabilities.seniorClaims.find(
      (r) => r.testId === "bs-plusd-outstanding",
    );

    expect(plusd?.caption).toBe("1:1 redeemable");
  });

  it("junior tranche renders from REST", () => {
    const { result } = renderHook(() => useBalanceSheetPanel(), {
      wrapper: makeWrapper(),
    });

    const junior = result.current.liabilities.subordinatedCapital.find(
      (r) => r.testId === "bs-junior-tranche",
    );

    expect(junior?.value).toBe("$500.0K");
  });

  it("cash USDC renders Horizon reserve balance string", () => {
    const { result } = renderHook(() => useBalanceSheetPanel(), {
      wrapper: makeWrapper(),
    });

    const cash = result.current.assets.liquid.find(
      (r) => r.testId === "bs-cash-usdc",
    );

    // "10000.0000000" → $10.0K
    expect(cash?.value).toBe("$10.0K");
  });
});

// ── Tests — unconfigured Horizon reads ───────────────────────────────────────

describe("useBalanceSheetPanel — unconfigured Horizon reads (graceful degradation)", () => {
  beforeEach(() => {
    mockRestData = REST_FIXTURE;
    mockPlusdData = undefined; // unconfigured
    mockUsdcData = undefined; // unconfigured
  });

  it("PLUSD row renders — when unconfigured", () => {
    const { result } = renderHook(() => useBalanceSheetPanel(), {
      wrapper: makeWrapper(),
    });

    const plusd = result.current.liabilities.seniorClaims.find(
      (r) => r.testId === "bs-plusd-outstanding",
    );
    expect(plusd?.value).toBe("—");
  });

  it("USDC row renders — when unconfigured", () => {
    const { result } = renderHook(() => useBalanceSheetPanel(), {
      wrapper: makeWrapper(),
    });

    const cash = result.current.assets.liquid.find(
      (r) => r.testId === "bs-cash-usdc",
    );
    expect(cash?.value).toBe("—");
  });

  it("REST rows still render when Horizon reads are unconfigured", () => {
    const { result } = renderHook(() => useBalanceSheetPanel(), {
      wrapper: makeWrapper(),
    });

    const secured = result.current.assets.deployed.find(
      (r) => r.testId === "bs-secured-loans",
    );
    expect(secured?.value).not.toBe("—");
    expect(secured?.value).toBe("$8.0M");
  });

  it("panel is still in ready state", () => {
    const { result } = renderHook(() => useBalanceSheetPanel(), {
      wrapper: makeWrapper(),
    });
    expect(result.current.state).toBe("ready");
  });
});

// ── Tests — USYC and off-chain rows ──────────────────────────────────────────

describe("useBalanceSheetPanel — USYC and off-chain rows", () => {
  beforeEach(() => {
    mockRestData = REST_FIXTURE;
  });

  it("USYC row always renders —", () => {
    const { result } = renderHook(() => useBalanceSheetPanel(), {
      wrapper: makeWrapper(),
    });

    const usyc = result.current.assets.liquid.find(
      (r) => r.testId === "bs-usyc",
    );
    expect(usyc?.value).toBe("—");
  });

  it("Off-chain USD row always renders —", () => {
    const { result } = renderHook(() => useBalanceSheetPanel(), {
      wrapper: makeWrapper(),
    });

    const offchain = result.current.assets.liquid.find(
      (r) => r.testId === "bs-offchain-usd",
    );
    expect(offchain?.value).toBe("—");
  });
});

// ── Tests — decimal/string formatting correctness ─────────────────────────────

describe("useBalanceSheetPanel — string formatting correctness", () => {
  beforeEach(() => {
    mockRestData = REST_FIXTURE;
  });

  it("formats a Horizon decimal string as compact USD", () => {
    // Horizon returns "1.0000000" for 1 PLUSD
    mockPlusdData = "1.0000000";

    const { result } = renderHook(() => useBalanceSheetPanel(), {
      wrapper: makeWrapper(),
    });

    const plusd = result.current.liabilities.seniorClaims.find(
      (r) => r.testId === "bs-plusd-outstanding",
    );

    // "1.0000000" → $1.00
    expect(plusd?.value).toBe("$1.00");
  });

  it("formats '0.0000000' as $0, not —", () => {
    mockUsdcData = "0.0000000";

    const { result } = renderHook(() => useBalanceSheetPanel(), {
      wrapper: makeWrapper(),
    });

    const cash = result.current.assets.liquid.find(
      (r) => r.testId === "bs-cash-usdc",
    );
    expect(cash?.value).toBe("$0");
  });
});

// ── Tests — totals disclaimer ─────────────────────────────────────────────────

describe("useBalanceSheetPanel — totals disclaimer", () => {
  it("showTotalsDisclaimer is true when some rows are unsourced", () => {
    mockRestData = REST_FIXTURE;
    mockPlusdData = undefined; // unsourced

    const { result } = renderHook(() => useBalanceSheetPanel(), {
      wrapper: makeWrapper(),
    });

    expect(result.current.showTotalsDisclaimer).toBe(true);
  });

  it("showTotalsDisclaimer is true because USYC/off-chain are always unsourced", () => {
    mockRestData = REST_FIXTURE;
    // Even with all Horizon data populated, USYC and off-chain remain —
    mockPlusdData = "43140000.0000000";
    mockUsdcData = "10000.0000000";

    const { result } = renderHook(() => useBalanceSheetPanel(), {
      wrapper: makeWrapper(),
    });

    // USYC and off-chain USD are always —
    expect(result.current.showTotalsDisclaimer).toBe(true);
  });
});
