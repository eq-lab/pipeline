// spec: docs/frontend/dashboard-components.md#usedeploymentmonitorpanel
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useDeploymentMonitorPanel } from "./useDeploymentMonitorPanel";
import type { LoanBookResponse } from "@/api/useLoanBook";
import type { SubmissionView } from "@/api/useLoanSubmissions";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { dashboardChain } = vi.hoisted(() => ({
  dashboardChain: {
    value: { kind: "stellar", chainId: 99_000_001 } as {
      kind: "evm" | "stellar";
      chainId: number;
    },
  },
}));

vi.mock("./useDashboardChain", () => ({
  useDashboardChain: () => dashboardChain.value,
}));

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
      chain_id: 560048,
      loan_id: "1",
      originator: "Open Mineral",
      borrower: "Open Mineral",
      commodity: "Copper Concentrate",
      principal: "8000.000000",
      ltv_bps: null,
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
    target_chain_id: 560048,
    chain_id: null,
    loan_id: null,
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
    target_chain_id: 560048,
    chain_id: null,
    loan_id: null,
    id: 2,
    status: "ChangesRequested",
    reason: "Docs incomplete",
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
    expect(result.current.rows[0]!.commodity).toBe("Copper Concentrate");
    expect(result.current.rows[0]!.principal).toBe("$8.0K");
  });

  it("keeps total_collateral on the summary card and drops per-loan collateral (#1907)", async () => {
    const fixture = {
      summary: {
        total_deployed: "31600.000000",
        total_collateral: "41973.000000",
        senior_debt_coverage: "1.50",
        avg_yield: "0.112000",
        avg_duration_days: 68,
      },
      loans: [{ ...FIXTURE_LOAN_BOOK.loans[0]!, ltv_bps: 8000 }],
    };
    localStorage.setItem(LOAN_BOOK_KEY, JSON.stringify(fixture));
    localStorage.setItem(SUBMISSIONS_KEY, JSON.stringify([]));

    const { result } = renderHook(() => useDeploymentMonitorPanel(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.state).toBe("ready"));

    expect(result.current.summary.totalCollateral).toBe("$42.0K");
    expect(result.current.summary.seniorDebtCoverage).toBe("1.5x");
    expect(result.current.rows[0]).not.toHaveProperty("collateral");
    expect(Object.keys(result.current.headerAggregates).sort()).toEqual([
      "ltv",
      "principal",
    ]);
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
    expect(row0.commodity).toBe("Alumina");
    expect(row0.facility).toBe("$8.0M");
    expect(row0.corridor).toBe("West Africa → EU");
    expect(row0.rate).toBe("11.2%");
    expect(row0.maturity).toBe("13 Mar 2024");
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
    expect(row1.facility).toBe("$4.4M");
    expect(row1.corridor).toBe("DRC → CN");
    expect(row1.rate).toBe("11.7%");
    expect(row1.maturity).toBe("13 Jan 2024");
    expect(row1.submitted).toBe("2 Jul");
    expect(row1.status).toBe("ChangesRequested");
  });

  it("filters out Approved and merged lifecycle-status submissions (#1053)", async () => {
    const drawn: SubmissionView[] = [
      { ...FIXTURE_SUBMISSIONS[0]!, id: 3, status: "Approved" },
      { ...FIXTURE_SUBMISSIONS[0]!, id: 4, status: "Performing" },
      { ...FIXTURE_SUBMISSIONS[0]!, id: 5, status: "Closed" },
    ];
    localStorage.setItem(LOAN_BOOK_KEY, JSON.stringify(FIXTURE_LOAN_BOOK));
    localStorage.setItem(
      SUBMISSIONS_KEY,
      JSON.stringify([...FIXTURE_SUBMISSIONS, ...drawn]),
    );

    const { result } = renderHook(() => useDeploymentMonitorPanel(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.originationState).toBe("ready"));
    expect(result.current.inOriginationCount).toBe(2);
    expect(result.current.originationRows.map((r) => r.id)).toEqual([1, 2]);
  });

  it("is empty when every submission is already a loan (#1053)", async () => {
    const drawn: SubmissionView[] = [
      { ...FIXTURE_SUBMISSIONS[0]!, id: 3, status: "Approved" },
      { ...FIXTURE_SUBMISSIONS[0]!, id: 4, status: "Performing" },
    ];
    localStorage.setItem(LOAN_BOOK_KEY, JSON.stringify(FIXTURE_LOAN_BOOK));
    localStorage.setItem(SUBMISSIONS_KEY, JSON.stringify(drawn));

    const { result } = renderHook(() => useDeploymentMonitorPanel(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.originationState).toBe("empty"));
    expect(result.current.inOriginationCount).toBe(0);
    expect(result.current.originationRows).toHaveLength(0);
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
    localStorage.setItem(LOAN_BOOK_KEY, JSON.stringify(FIXTURE_LOAN_BOOK));
    fetchMock.mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useDeploymentMonitorPanel(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(result.current.originationState).toBe("loading");
  });
});

// ── LTV from ltv_bps ────────────────────────────────────────────────────────

function loanWith(ltvBps?: number | null) {
  const loan: Record<string, unknown> = {
    chain_id: 99_000_001,
    loan_id: "1",
    originator: "A",
    borrower: "A",
    commodity: "X",
    principal: "8000.000000",
    duration_days: 120,
    rate: "0.112000",
    protection: null,
    status: "Performing",
  };
  if (ltvBps !== undefined) loan.ltv_bps = ltvBps;
  return loan;
}

function bookWith(loans: unknown[]) {
  return {
    summary: {
      total_deployed: "31600.000000",
      total_collateral: null,
      senior_debt_coverage: null,
      avg_yield: "0.112000",
      avg_duration_days: 68,
    },
    loans,
  };
}

async function renderWithBook(book: unknown) {
  localStorage.setItem(LOAN_BOOK_KEY, JSON.stringify(book));
  localStorage.setItem(SUBMISSIONS_KEY, JSON.stringify([]));
  const hook = renderHook(() => useDeploymentMonitorPanel(), {
    wrapper: makeWrapper(),
  });
  await waitFor(() => expect(hook.result.current.state).toBe("ready"));
  return hook.result.current;
}

describe("useDeploymentMonitorPanel — LTV from ltv_bps", () => {
  it("Phase-2 Stellar shape: rows, null excluded from the mean, no collateral key", async () => {
    const panel = await renderWithBook(
      bookWith([loanWith(8000), loanWith(9000), loanWith(null)]),
    );

    expect(panel.rows.map((r) => r.ltv)).toEqual(["80%", "90%", "—"]);
    expect(panel.headerAggregates.ltv).toBe("85%");
    for (const row of panel.rows) expect(row).not.toHaveProperty("collateral");
  });

  it("shows the sentinel as no security value and excludes it from the mean", async () => {
    const panel = await renderWithBook(
      bookWith([loanWith(8000), loanWith(4294967295)]),
    );

    expect(panel.rows.map((r) => r.ltv)).toEqual(["80%", "No security value"]);
    expect(panel.headerAggregates.ltv).toBe("80%");
  });

  it("rounds the mean up", async () => {
    const panel = await renderWithBook(
      bookWith([loanWith(8001), loanWith(8002)]),
    );

    expect(panel.headerAggregates.ltv).toBe("80.1%");
  });

  it("counts a zero LTV in the mean", async () => {
    const panel = await renderWithBook(bookWith([loanWith(0), loanWith(8000)]));

    expect(panel.headerAggregates.ltv).toBe("40%");
  });

  it("Phase-2 EVM shape: every row is an em-dash and the aggregate is undefined", async () => {
    const panel = await renderWithBook(
      bookWith([loanWith(null), loanWith(null)]),
    );

    expect(panel.rows.map((r) => r.ltv)).toEqual(["—", "—"]);
    expect(panel.headerAggregates.ltv).toBeUndefined();
  });

  it("today's shape: legacy keys are ignored in favour of ltv_bps", async () => {
    const legacy = {
      ...loanWith(8123),
      collateral: "20986.500000",
      ltv: "0.5718",
      ccr_bps: 15000,
      spot_price: "100.0",
      spot_change_7d: "0.01",
    };
    const book = bookWith([legacy]);
    book.summary.total_collateral = "41973.000000" as unknown as null;

    const panel = await renderWithBook(book);

    expect(panel.rows[0]!.ltv).toBe("81.3%");
    expect(panel.rows[0]).not.toHaveProperty("collateral");
    expect(panel.summary.totalCollateral).toBe("$42.0K");
  });

  it("pre-Phase-1 shape: no ltv_bps key renders em-dashes without throwing", async () => {
    const panel = await renderWithBook(bookWith([loanWith(), loanWith()]));

    expect(panel.rows.map((r) => r.ltv)).toEqual(["—", "—"]);
    expect(panel.headerAggregates.ltv).toBeUndefined();
  });

  it("leaves the ltv aggregate undefined when there are no loans", async () => {
    const panel = await renderWithBook({
      summary: {
        total_deployed: "0.000000",
        total_collateral: null,
        senior_debt_coverage: null,
        avg_yield: null,
        avg_duration_days: null,
      },
      loans: [],
    });

    expect(panel.headerAggregates.ltv).toBeUndefined();
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

describe("useDeploymentMonitorPanel — dashboard chain", () => {
  afterEach(() => {
    dashboardChain.value = { kind: "stellar", chainId: 99_000_001 };
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("sends the dashboard chainId on loan-book requests but not on submissions", async () => {
    localStorage.clear();
    dashboardChain.value = { kind: "evm", chainId: 560048 };
    const fetchStub = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response("{}", { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchStub);

    renderHook(() => useDeploymentMonitorPanel(), { wrapper: makeWrapper() });

    await waitFor(() => expect(fetchStub).toHaveBeenCalled());
    const urls = fetchStub.mock.calls.map((c) => String(c[0]));
    expect(
      urls.some(
        (u) => u.includes("/v1/loan-book?") && u.includes("chain_id=560048"),
      ),
    ).toBe(true);
    const submissionUrls = urls.filter((u) =>
      u.includes("/v1/loan-book/submissions"),
    );
    expect(submissionUrls.length).toBeGreaterThan(0);
    expect(submissionUrls.every((u) => !u.includes("chain_id"))).toBe(true);
  });
});
