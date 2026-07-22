/**
 * Tests for `src/components/dashboard/useDeploymentMonitorPanel.ts`.
 *
 * Covers:
 *   - Panel-level state machine (Active Loans query): loading / error / ready.
 *   - In Origination tab (issue #755): independent state machine, submission →
 *     row mapping, count badge, and the fact that a loading/empty submissions
 *     query does NOT force the panel out of "ready".
 *   - Tab selection state.
 *
 * Uses the `pipeline.mock.api.*` localStorage mock layer (same approach as
 * `useWithdrawalQueuePanel.test.tsx`).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useDeploymentMonitorPanel } from "./useDeploymentMonitorPanel";
import type { LoanBookResponse } from "@/api/useLoanBook";
import type { SubmissionView } from "@/api/useLoanSubmissions";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/wallet", () => ({
  useWalletView: () => ({ kind: "evm" }),
  useEvmWallet: () => ({ address: undefined, isConnected: false }),
  useStellarWallet: () => ({ address: undefined, isConnected: false }),
  subscribeMock: () => () => {},
  readMock: (key: string, parse: (raw: string) => unknown) => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return undefined;
      return parse(raw);
    } catch {
      return undefined;
    }
  },
  parseJson: (value: string) => JSON.parse(value) as unknown,
}));

vi.mock("@/lib/env", () => ({
  ENV: {
    API_BASE_URL: "http://localhost:8080",
    EVM_CHAIN_ID: 560048,
    STELLAR_CHAIN_ID: 99_000_001,
    EVM_RPC_URL: "https://ethereum-hoodi-rpc.publicnode.com",
    DEPOSIT_MANAGER_ADDRESS: "0x0000000000000000000000000000000000000000",
    WALLETCONNECT_PROJECT_ID: "replace-me",
  },
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const LOAN_BOOK_KEY = "pipeline.mock.api.GET./v1/loan-book";
const SUBMISSIONS_KEY = "pipeline.mock.api.GET./v1/loan-book/submissions";

// Issue #906: the frontend no longer rescales `total_deployed`/`principal`/
// `collateral`/`total_collateral` (the former ×1000 `formatRegistryCompactUsd`
// workaround, #840/#888, has been removed) — every value is displayed exactly
// as served, via plain `formatCompactUsd`.
const FIXTURE_LOAN_BOOK: LoanBookResponse = {
  summary: {
    total_deployed: "31600.000000",
    total_collateral: null,
    senior_debt_coverage: null,
    avg_yield: "0.112000",
    avg_duration_days: 68,
  },
  loans: [
    {
      originator: "Open Mineral",
      borrower: "Open Mineral",
      commodity: "Copper Concentrate",
      principal: "8000.000000",
      collateral: null,
      ltv: null,
      duration_days: 120,
      rate: "0.112000",
      protection: "LC at sight",
      status: "Performing",
    },
  ],
};

const ORIGINATION_DATE = 1_700_000_000;
const MATURITY_120D = ORIGINATION_DATE + 120 * 86_400;

const FIXTURE_SUBMISSIONS: SubmissionView[] = [
  {
    id: 1,
    status: "InReview",
    reason: null,
    originator: "0xabc",
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    loan_data: {
      to: "0xdef",
      metadata_uri: "ipfs://meta",
      originator: "0xabc",
      borrower_id: "Trafigura",
      commodity: "Alumina",
      corridor: "West Africa → EU",
      governing_law: "English",
      economics: {
        original_facility_size: "8000000.000000",
        original_senior_tranche: "6000000.000000",
        original_equity_tranche: "2000000.000000",
        original_offtaker_price: "9000000.000000",
        senior_interest_rate_bps: 1120,
        origination_date: ORIGINATION_DATE,
        original_maturity_date: MATURITY_120D,
      },
      // 1e6 / 1_176_470 ≈ 0.8500 → 85%
      initial_ccr: 1_176_470,
      initial_location: {
        location_type: "Warehouse",
        location_identifier: "W-1",
        tracking_url: "https://track/1",
        updated_at: ORIGINATION_DATE,
      },
      protection: "LC at sight",
    },
  },
  {
    id: 2,
    status: "Approved",
    reason: null,
    originator: "0x123",
    created_at: "2026-07-02T00:00:00Z",
    updated_at: "2026-07-02T00:00:00Z",
    loan_data: {
      to: "0x456",
      metadata_uri: "ipfs://meta2",
      originator: "0x123",
      borrower_id: "Cobalt Trading",
      commodity: "Cobalt",
      corridor: "DRC → CN",
      governing_law: "English",
      economics: {
        original_facility_size: "4400000.000000",
        original_senior_tranche: "3400000.000000",
        original_equity_tranche: "1000000.000000",
        original_offtaker_price: "5000000.000000",
        senior_interest_rate_bps: 1170,
        origination_date: ORIGINATION_DATE,
        original_maturity_date: ORIGINATION_DATE + 60 * 86_400,
      },
      initial_ccr: 2_000_000, // 1e6 / 2e6 = 0.5 → 50%
      initial_location: {
        location_type: "Vessel",
        location_identifier: "IMO-2",
        tracking_url: "https://track/2",
        updated_at: ORIGINATION_DATE,
      },
      // protection omitted → "—"
    },
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
  return wrapper;
}

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockClear();
});

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

// ── Panel-level state ───────────────────────────────────────────────────────

describe("useDeploymentMonitorPanel — panel state", () => {
  it("is loading while the loan-book query is in-flight", () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useDeploymentMonitorPanel(), {
      wrapper: makeWrapper(),
    });

    expect(result.current.state).toBe("loading");
    expect(result.current.rows).toHaveLength(0);
    expect(result.current.activeLoansCount).toBe(0);
  });

  it("is error when the loan-book query fails", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "server error" }), {
        status: 500,
        statusText: "Internal Server Error",
      }),
    );

    const { result } = renderHook(() => useDeploymentMonitorPanel(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.state).toBe("error"));
    expect(result.current.errorMessage).toBeDefined();
  });

  it("is ready with formatted active-loan rows", async () => {
    localStorage.setItem(LOAN_BOOK_KEY, JSON.stringify(FIXTURE_LOAN_BOOK));
    localStorage.setItem(SUBMISSIONS_KEY, JSON.stringify(FIXTURE_SUBMISSIONS));

    const { result } = renderHook(() => useDeploymentMonitorPanel(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(result.current.activeLoansCount).toBe(1);
    expect(result.current.rows[0]!.borrowerCommodity).toBe(
      "Open Mineral / Copper Concentrate",
    );
    expect(result.current.rows[0]!.principal).toBe("$8.0K");
  });

  // Issue #906: collateral and principal are both displayed exactly as
  // served — verify the row, the summary card, and the table header
  // aggregate all render the plain-formatted value, with no rescaling.
  it("displays collateral and principal as served, in the row, summary, and header aggregate (#906)", async () => {
    const fixture: LoanBookResponse = {
      summary: {
        total_deployed: "31600.000000",
        total_collateral: "41973.000000",
        senior_debt_coverage: null,
        avg_yield: "0.112000",
        avg_duration_days: 68,
      },
      loans: [
        {
          originator: "Open Mineral",
          borrower: "Open Mineral",
          commodity: "Copper Concentrate",
          principal: "8000.000000",
          collateral: "20986.500000",
          ltv: "0.5718",
          duration_days: 120,
          rate: "0.112000",
          protection: "LC at sight",
          status: "Performing",
        },
      ],
    };
    localStorage.setItem(LOAN_BOOK_KEY, JSON.stringify(fixture));
    localStorage.setItem(SUBMISSIONS_KEY, JSON.stringify([]));

    const { result } = renderHook(() => useDeploymentMonitorPanel(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.state).toBe("ready"));

    expect(result.current.rows[0]!.collateral).toBe("$21.0K");
    expect(result.current.summary.totalCollateral).toBe("$42.0K");
    expect(result.current.headerAggregates.collateral).toBe("$42.0K");
  });
});

// ── In Origination tab ──────────────────────────────────────────────────────

describe("useDeploymentMonitorPanel — In Origination tab", () => {
  it("maps a submission's loan_data into an OriginationTableRow (issue #814 field set)", async () => {
    localStorage.setItem(LOAN_BOOK_KEY, JSON.stringify(FIXTURE_LOAN_BOOK));
    localStorage.setItem(SUBMISSIONS_KEY, JSON.stringify(FIXTURE_SUBMISSIONS));

    const { result } = renderHook(() => useDeploymentMonitorPanel(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.originationState).toBe("ready"));

    expect(result.current.inOriginationCount).toBe(2);
    const row0 = result.current.originationRows[0]!;
    // Originator is loan_data.originator (the submitted name), not the
    // top-level submitter address — same value in this fixture, but the
    // mapping source matters (see originationRow.test.ts for the distinction).
    expect(row0.originator).toBe("0xabc");
    expect(row0.commodity).toBe("Alumina");
    expect(row0.facility).toBe("$8.0M"); // compact, matching Active Loans (#841)
    expect(row0.corridor).toBe("West Africa → EU");
    expect(row0.rate).toBe("11.2%"); // 1120 bps (backend-served)
    expect(row0.maturity).toBe("14 Mar 2024");
    expect(row0.submitted).toBe("1 Jul");
    expect(row0.status).toBe("InReview");
  });

  it("reflects the second row's fields", async () => {
    localStorage.setItem(LOAN_BOOK_KEY, JSON.stringify(FIXTURE_LOAN_BOOK));
    localStorage.setItem(SUBMISSIONS_KEY, JSON.stringify(FIXTURE_SUBMISSIONS));

    const { result } = renderHook(() => useDeploymentMonitorPanel(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.originationState).toBe("ready"));

    const row1 = result.current.originationRows[1]!;
    expect(row1.commodity).toBe("Cobalt");
    expect(row1.facility).toBe("$4.4M"); // compact, matching Active Loans (#841)
    expect(row1.corridor).toBe("DRC → CN");
    expect(row1.rate).toBe("11.7%"); // 1170 bps
    expect(row1.maturity).toBe("14 Jan 2024");
    expect(row1.submitted).toBe("2 Jul");
    expect(row1.status).toBe("Approved");
  });

  it("is empty (badge 0) when no submissions exist", async () => {
    localStorage.setItem(LOAN_BOOK_KEY, JSON.stringify(FIXTURE_LOAN_BOOK));
    localStorage.setItem(SUBMISSIONS_KEY, JSON.stringify([]));

    const { result } = renderHook(() => useDeploymentMonitorPanel(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.state).toBe("ready"));
    await waitFor(() => expect(result.current.originationState).toBe("empty"));
    expect(result.current.inOriginationCount).toBe(0);
    expect(result.current.originationRows).toHaveLength(0);
  });

  it("stays ready even while the submissions query is still loading", async () => {
    // loan-book resolves from the mock; submissions has no mock key → real
    // fetch, which never resolves → origination stays loading.
    localStorage.setItem(LOAN_BOOK_KEY, JSON.stringify(FIXTURE_LOAN_BOOK));
    fetchMock.mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useDeploymentMonitorPanel(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.state).toBe("ready"));
    // Panel is ready; origination tab independently reports loading.
    expect(result.current.originationState).toBe("loading");
  });
});

// ── LTV header aggregate ────────────────────────────────────────────────────

describe("useDeploymentMonitorPanel — LTV header aggregate", () => {
  it("computes average LTV with null → 0 for a single loan with null ltv", async () => {
    // FIXTURE_LOAN_BOOK has one loan with ltv: null → null → 0, avg = 0/1 = 0 → "0%"
    localStorage.setItem(LOAN_BOOK_KEY, JSON.stringify(FIXTURE_LOAN_BOOK));
    localStorage.setItem(SUBMISSIONS_KEY, JSON.stringify([]));

    const { result } = renderHook(() => useDeploymentMonitorPanel(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.state).toBe("ready"));

    // ltv: null → 0 contribution. avg = 0 / 1 = 0 → formatLtv("0") = "0%"
    expect(result.current.headerAggregates.ltv).toBe("0%");
  });

  it("computes average LTV correctly for mixed null/valued ltv", async () => {
    const fixture = {
      summary: {
        total_deployed: "31600.000000",
        total_collateral: null,
        senior_debt_coverage: null,
        avg_yield: "0.112000",
        avg_duration_days: 68,
      },
      loans: [
        {
          originator: "A",
          borrower: "A",
          commodity: "X",
          principal: "8000.000000",
          collateral: null,
          ltv: "0.8000", // → 0.8
          duration_days: 120,
          rate: "0.112000",
          protection: null,
          status: "Performing",
        },
        {
          originator: "B",
          borrower: "B",
          commodity: "Y",
          principal: "4000.000000",
          collateral: null,
          ltv: null, // → 0
          duration_days: 60,
          rate: "0.110000",
          protection: null,
          status: "Performing",
        },
      ],
    };
    localStorage.setItem(LOAN_BOOK_KEY, JSON.stringify(fixture));
    localStorage.setItem(SUBMISSIONS_KEY, JSON.stringify([]));

    const { result } = renderHook(() => useDeploymentMonitorPanel(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.state).toBe("ready"));

    // avg = (0.8 + 0) / 2 = 0.4 → formatLtv("0.4") = "40%"
    expect(result.current.headerAggregates.ltv).toBe("40%");
  });

  it("leaves ltv aggregate undefined when there are no loans", async () => {
    const emptyLoansFixture = {
      summary: {
        total_deployed: "0.000000",
        total_collateral: null,
        senior_debt_coverage: null,
        avg_yield: null,
        avg_duration_days: null,
      },
      loans: [],
    };
    localStorage.setItem(LOAN_BOOK_KEY, JSON.stringify(emptyLoansFixture));
    localStorage.setItem(SUBMISSIONS_KEY, JSON.stringify([]));

    const { result } = renderHook(() => useDeploymentMonitorPanel(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.state).toBe("ready"));

    expect(result.current.headerAggregates.ltv).toBeUndefined();
  });
});

// ── Tab selection ─────────────────────────────────────────────────────────────

describe("useDeploymentMonitorPanel — tab selection", () => {
  it("defaults to the active tab and switches on setActiveTab", async () => {
    localStorage.setItem(LOAN_BOOK_KEY, JSON.stringify(FIXTURE_LOAN_BOOK));
    localStorage.setItem(SUBMISSIONS_KEY, JSON.stringify(FIXTURE_SUBMISSIONS));

    const { result } = renderHook(() => useDeploymentMonitorPanel(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(result.current.activeTab).toBe("active");

    act(() => result.current.setActiveTab("origination"));
    expect(result.current.activeTab).toBe("origination");
  });
});
