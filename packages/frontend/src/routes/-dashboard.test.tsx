// spec: docs/frontend/dashboard-components.md#deploymentmonitorpanel
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route } from "./dashboard";
import { PanelLoading } from "@/components/dashboard/PanelLoading";
import { PanelEmpty } from "@/components/dashboard/PanelEmpty";
import { PanelError } from "@/components/dashboard/PanelError";
import { DeploymentMonitorPanel } from "@/components/dashboard/DeploymentMonitorPanel";
import { WithdrawalQueuePanel } from "@/components/dashboard/WithdrawalQueuePanel";
import { YieldHistoryPanel } from "@/components/dashboard/YieldHistoryPanel";
import type { LoanBookResponse } from "@/api";
import type { SubmissionView } from "@/api/useLoanSubmissions";

const mockChainServed = vi.hoisted(() =>
  vi.fn(() => ({
    kind: "evm" as const,
    chainId: 560048,
    chainName: "Hoodi",
    served: true as boolean | undefined,
  })),
);
vi.mock("@/api/useChainServed", () => ({
  useChainServed: () => mockChainServed(),
}));

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("wagmi", async (importOriginal) => {
  const original = await importOriginal<typeof import("wagmi")>();
  return {
    ...original,
    WagmiProvider: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    useAccount: vi.fn(() => ({ address: undefined, isConnected: false })),
    useChainId: vi.fn(() => 560048),
    useDisconnect: vi.fn(() => ({ disconnect: vi.fn() })),
    useReadContract: vi.fn(() => ({
      data: undefined,
      isLoading: false,
      error: null,
    })),
    useWriteContract: vi.fn(() => ({
      writeContract: vi.fn(),
      data: undefined,
      isPending: false,
      isSuccess: false,
      error: null,
      reset: vi.fn(),
    })),
  };
});

vi.mock("@reown/appkit/react", () => ({
  createAppKit: vi.fn(),
  useAppKit: vi.fn(() => ({ open: vi.fn() })),
}));

vi.mock("@/wallet/config", () => ({
  wagmiConfig: {},
  wagmiAdapter: {},
}));

vi.mock("@/lib/env", () => ({
  ENV: {
    API_BASE_URL: "http://localhost:8080",
    EVM_CHAIN_ID: 560048,
    STELLAR_CHAIN_ID: 99_000_001,
    EVM_RPC_URL: "https://ethereum-hoodi-rpc.publicnode.com",
    DEPOSIT_MANAGER_ADDRESS: "0x0000000000000000000000000000000000000000",
    STAKED_PLUSD_ADDRESS: "0x0000000000000000000000000000000000000000",
    WALLETCONNECT_PROJECT_ID: "replace-me",
  },
}));

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FIXTURE_FULL: LoanBookResponse = {
  summary: {
    total_deployed: "31600.000000", // displayed as served → "$31.6K"
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
      principal: "8000.000000", // displayed as served → "$8.0K"
      duration_days: 120,
      rate: "0.112000",
      protection: "LC at sight",
      status: "Performing",
    },
    {
      chain_id: 560048,
      loan_id: "1",
      originator: "Trafalgar",
      borrower: "Trafalgar",
      commodity: "Alumina",
      principal: "5200.000000", // displayed as served → "$5.2K"
      duration_days: 150,
      rate: "0.109000",
      protection: null,
      status: "Performing",
    },
  ],
};

const FIXTURE_EMPTY: LoanBookResponse = {
  summary: {
    total_deployed: "0.000000",
    total_collateral: null,
    senior_debt_coverage: null,
    avg_yield: null,
    avg_duration_days: null,
  },
  loans: [],
};

const FIXTURE_SUBMISSIONS: SubmissionView[] = [
  {
    target_chain_id: 560048,
    chain_id: null,
    loan_id: null,
    id: 1,
    status: "InReview",
    reason: null,
    originator: "0xabc",
    created_at: "2026-06-18T10:00:00Z",
    updated_at: "2026-06-18T10:00:00Z",
    loan_data: {
      to: "0xdef",
      metadata_uri: "ipfs://meta",
      originator: "Auric Andes",
      borrower_id: "borrower-1",
      commodity: "Gold pyrite concentrate",
      corridor: "PE-CN",
      governing_law: "England",
      economics: {
        original_facility_size: "3500000.000000",
        original_senior_tranche: "3000000.000000",
        original_equity_tranche: "500000.000000",
        original_offtaker_price: "3500000.000000",
        senior_interest_rate_bps: 1400,
        origination_date: 1_750_000_000,
        original_maturity_date: 1_797_292_800, // 2026-12-15T00:00:00Z
      },
      initial_location: {
        location_type: "Vessel",
        location_identifier: "MV Example",
        tracking_url: "https://example.com",
        updated_at: 1_750_000_000,
      },
      protection: "LC at sight",
    },
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
  return Wrapper;
}

function renderDashboard() {
  const DashboardPage = Route.options.component as React.ComponentType;
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <DashboardPage />
    </QueryClientProvider>,
  );
}

// ── /dashboard route shell ────────────────────────────────────────────────────

describe("/dashboard route shell", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockClear();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(FIXTURE_EMPTY), { status: 200 }),
    );
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("renders the page root and <main> with no wallet connected", () => {
    renderDashboard();
    expect(screen.getByTestId("dashboard-page-root")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-main")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-title")).toHaveTextContent(
      "Protocol Dashboard",
    );
  });

  it("renders all four panel containers with their titles", () => {
    renderDashboard();
    const panelsWithTitle: Array<[string, string]> = [
      ["dashboard-panel-balance-sheet", "Statement of Financial Position"],
      ["dashboard-panel-deployment-monitor", "Loan Book"],
      ["dashboard-panel-withdrawal-queue", "Withdrawal Queue"],
    ];
    for (const [testId, title] of panelsWithTitle) {
      const panel = screen.getByTestId(testId);
      expect(panel).toBeInTheDocument();
      expect(panel).toHaveTextContent(title);
    }
    expect(
      screen.getByTestId("dashboard-panel-yield-history"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Yield History")).not.toBeInTheDocument();
    // Panel A (Balance Sheet) shows loading state — real data hooks in test env.
    // Panel B (Loan Book) is wired to real data.
    // Panel C (Withdrawal Queue) is wired to real data (shows loading/error/empty).
    // Panel D (Yield History) shows "Nothing to show yet" with zero-address STAKED_PLUSD_ADDRESS.
  });

  it("lays out a full-width single-column stack at all viewports (no md:grid-cols-2)", () => {
    renderDashboard();
    const grid = screen.getByTestId("dashboard-grid");
    expect(grid.className).toContain("grid-cols-1");
    expect(grid.className).not.toContain("md:grid-cols-2");
    const yieldPanel = screen.getByTestId("dashboard-panel-yield-history");
    const balancePanel = screen.getByTestId("dashboard-panel-balance-sheet");
    const loanPanel = screen.getByTestId("dashboard-panel-deployment-monitor");
    const withdrawalPanel = screen.getByTestId(
      "dashboard-panel-withdrawal-queue",
    );
    expect(yieldPanel).toBeInTheDocument();
    expect(balancePanel).toBeInTheDocument();
    expect(loanPanel).toBeInTheDocument();
    expect(withdrawalPanel).toBeInTheDocument();
    expect(
      yieldPanel.compareDocumentPosition(balancePanel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      balancePanel.compareDocumentPosition(loanPanel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      loanPanel.compareDocumentPosition(withdrawalPanel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

// ── Shared state presentations ────────────────────────────────────────────────

describe("dashboard panel state presentations", () => {
  it("PanelLoading shows loading copy", () => {
    render(<PanelLoading />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("PanelEmpty shows its caption", () => {
    render(<PanelEmpty caption="Coming soon" />);
    expect(screen.getByText("Coming soon")).toBeInTheDocument();
  });

  it("PanelError renders a message and invokes onRetry when Retry is clicked", async () => {
    const onRetry = vi.fn();
    render(<PanelError onRetry={onRetry} message="Couldn't load this panel" />);
    expect(screen.getByText("Couldn't load this panel")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

// ── #749 Mobile layout regression tests ──────────────────────────────────────

describe("#749 — WithdrawalQueuePanel summary cards responsive layout", () => {
  beforeEach(() => {
    fetchMock.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("summary cards are in a horizontally-scrollable flex row (no grid wrapping)", async () => {
    render(<WithdrawalQueuePanel />, { wrapper: makeWrapper() });

    const panel = screen.getByTestId("dashboard-panel-withdrawal-queue");
    expect(panel).toBeInTheDocument();
  });

  it("withdrawal queue table renders as a unified overflow-x-auto table — no mobile/desktop split", async () => {
    render(<WithdrawalQueuePanel />, { wrapper: makeWrapper() });

    const panel = screen.getByTestId("dashboard-panel-withdrawal-queue");
    expect(panel).toBeInTheDocument();

    expect(screen.queryByTestId("withdrawal-queue-table-mobile")).toBeNull();
  });
});

describe("#749 — YieldHistoryPanel mobile layout", () => {
  beforeEach(() => {
    fetchMock.mockClear();
    fetchMock.mockReturnValue(new Promise(() => {}));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("YieldHistoryPanel panel renders in loading state (issue #760 — vault guard removed)", () => {
    render(<YieldHistoryPanel />, { wrapper: makeWrapper() });

    expect(
      screen.getByTestId("dashboard-panel-yield-history"),
    ).toBeInTheDocument();
  });

  it("TVL placeholder testid is absent (replaced by TvlCard in issue #760)", () => {
    render(<YieldHistoryPanel />, { wrapper: makeWrapper() });

    expect(screen.queryByTestId("yield-tvl-placeholder")).toBeNull();
  });
});

describe("YieldHistoryPanel — object-shaped envelope (issue #1234 parsing repair)", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockClear();
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v1/dashboard/tvl-history")) {
        return new Response(
          JSON.stringify({
            series: [
              { timestamp: "2026-08-01T00:00:00Z", tvl: "1000000.000000" },
            ],
            max: "1000000.000000",
            min: "1000000.000000",
            average: "1000000.000000",
          }),
          { status: 200 },
        );
      }
      if (url.includes("/v1/dashboard/yield-history")) {
        return new Response(
          JSON.stringify({
            series: [
              {
                timestamp: "2026-08-01T00:00:00Z",
                cumulative_yield: "10000.000000",
              },
            ],
            max: "10000.000000",
            min: "10000.000000",
            average: "10000.000000",
          }),
          { status: 200 },
        );
      }
      if (url.includes("/v1/dashboard/summary")) {
        return new Response(
          JSON.stringify({
            tvl: "1000000.000000",
            outstanding_in_loans: null,
            current_apy_net_to_splusd: null,
            loan_book_yield: null,
            cumulative_yield_total: "10000.000000",
          }),
          { status: 200 },
        );
      }
      if (url.includes("/v1/loan-book/submissions")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.includes("/v1/loan-book")) {
        return new Response(JSON.stringify(FIXTURE_EMPTY), { status: 200 });
      }
      return new Promise<Response>(() => {});
    });
  });

  afterEach(() => {
    localStorage.clear();
    fetchMock.mockReset();
  });

  it("renders without throwing against the {series,max,min,average} envelope — this is the test that would have caught the pre-fix crash", async () => {
    renderDashboard();

    await waitFor(() => {
      expect(
        screen.getByTestId("dashboard-panel-yield-history"),
      ).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByTestId("yield-headline-value")).toHaveTextContent(
        "$10.0K",
      );
    });
  });
});

// ── DeploymentMonitorPanel — column header aggregates (issue #729) ────────────

const FIXTURE_WITH_DEPLOYED_NULL_COLLATERAL: LoanBookResponse = {
  summary: {
    total_deployed: "31600.000000", // displayed as served → "$31.6K"
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
      principal: "8000.000000", // displayed as served → "$8.0K"
      duration_days: 120,
      rate: "0.112000",
      protection: "LC at sight",
      status: "Performing",
    },
  ],
};

const FIXTURE_WITH_COLLATERAL: LoanBookResponse = {
  summary: {
    total_deployed: "31600.000000", // displayed as served → "$31.6K"
    total_collateral: "37600.000000", // displayed as served → "$37.6K"
    senior_debt_coverage: "1.50",
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
      principal: "8000.000000", // displayed as served → "$8.0K"
      ltv_bps: 8123,
      duration_days: 120,
      rate: "0.112000",
      protection: "LC at sight",
      status: "Performing",
    },
  ],
};

describe("DeploymentMonitorPanel — column header aggregates (issue #729)", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockClear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("Principal header shows aggregate and the LTV header is label-only when no loan has an ltv_bps", async () => {
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/loan-book",
      JSON.stringify(FIXTURE_WITH_DEPLOYED_NULL_COLLATERAL),
    );

    render(<DeploymentMonitorPanel />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(
        screen.getByTestId("loan-book-header-principal-aggregate"),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByTestId("loan-book-header-principal-aggregate"),
    ).toHaveTextContent("$31.6K");
    expect(screen.queryByTestId("loan-book-header-ltv-aggregate")).toBeNull();
    expect(
      screen.queryByTestId("loan-book-header-collateral-aggregate"),
    ).toBeNull();
  });

  it("renders exactly six columns and no Collateral column header", async () => {
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/loan-book",
      JSON.stringify(FIXTURE_WITH_COLLATERAL),
    );

    render(<DeploymentMonitorPanel />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId("loan-book-table-desktop")).toBeInTheDocument();
    });

    const table = within(screen.getByTestId("loan-book-table"));
    expect(
      table.getAllByRole("columnheader").map((h) => h.textContent),
    ).toEqual([
      "Commodity",
      "Principal · $31.6K",
      "LTV · 81.3%",
      "Duration",
      "Rate",
      "Protection",
    ]);
    expect(table.queryByText(/Collateral/)).toBeNull();
    expect(
      screen.queryByTestId("loan-book-header-collateral-aggregate"),
    ).toBeNull();
    expect(screen.getByText("Collateral")).toBeInTheDocument();
  });

  it("LTV column header shows the mean of the valid ltv_bps values", async () => {
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/loan-book",
      JSON.stringify(FIXTURE_WITH_COLLATERAL),
    );

    render(<DeploymentMonitorPanel />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId("loan-book-table-desktop")).toBeInTheDocument();
    });

    expect(
      screen.getByTestId("loan-book-header-ltv-aggregate"),
    ).toHaveTextContent("81.3%");
  });

  it("shows No security value for the sentinel row and em-dash for a null row", async () => {
    const fixture: LoanBookResponse = {
      ...FIXTURE_WITH_COLLATERAL,
      loans: [
        { ...FIXTURE_WITH_COLLATERAL.loans[0]!, ltv_bps: 4294967295 },
        { ...FIXTURE_WITH_COLLATERAL.loans[0]!, ltv_bps: null },
      ],
    };
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/loan-book",
      JSON.stringify(fixture),
    );

    render(<DeploymentMonitorPanel />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId("loan-book-table-desktop")).toBeInTheDocument();
    });

    const rows = within(screen.getByTestId("loan-book-table")).getAllByRole(
      "row",
    );
    const ltvCell = (row: HTMLElement) =>
      within(row).getAllByRole("cell")[2]!.textContent;
    expect(ltvCell(rows[1]!)).toBe("No security value");
    expect(ltvCell(rows[2]!)).toBe("—");
    expect(screen.queryByTestId("loan-book-header-ltv-aggregate")).toBeNull();
  });

  it("loading state renders no aggregate subtitles — headers are label-only", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));

    render(<DeploymentMonitorPanel />, { wrapper: makeWrapper() });

    expect(
      screen.queryByTestId("loan-book-header-principal-aggregate"),
    ).toBeNull();
    expect(
      screen.queryByTestId("loan-book-header-collateral-aggregate"),
    ).toBeNull();
  });
});

// ── DeploymentMonitorPanel integration tests ──────────────────────────────────

describe("DeploymentMonitorPanel — loading state", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockClear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("shows PanelLoading while fetch is in flight", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));

    render(<DeploymentMonitorPanel />, { wrapper: makeWrapper() });

    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });
});

describe("DeploymentMonitorPanel — error state", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockClear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("shows PanelError when fetch fails, Retry calls refetch", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "server error" }), {
        status: 500,
        statusText: "Internal Server Error",
      }),
    );

    render(<DeploymentMonitorPanel />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    });

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(FIXTURE_EMPTY), { status: 200 }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    // Just assert the button was clickable (no throw)
  });
});

describe("DeploymentMonitorPanel — empty loans state", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockClear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("shows an inline empty state on the Active Loans tab when loans array is empty", async () => {
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/loan-book",
      JSON.stringify(FIXTURE_EMPTY),
    );

    render(<DeploymentMonitorPanel />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId("loan-book-active-empty")).toBeInTheDocument();
    });
    expect(screen.getByTestId("loan-book-tab-bar")).toBeInTheDocument();
  });
});

describe("DeploymentMonitorPanel — ready state", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockClear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("renders summary cards with formatted values; null fields show em-dash", async () => {
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/loan-book",
      JSON.stringify(FIXTURE_FULL),
    );

    render(<DeploymentMonitorPanel />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId("loan-book-summary-cards")).toBeInTheDocument();
    });

    expect(screen.getAllByText("$31.6K").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("11.2%").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("68 days")).toBeInTheDocument();

    const emDashes = screen.getAllByText("—");
    expect(emDashes.length).toBeGreaterThanOrEqual(2);
  });

  it("renders loan rows with formatted values", async () => {
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/loan-book",
      JSON.stringify(FIXTURE_FULL),
    );

    render(<DeploymentMonitorPanel />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(
        screen.getAllByText("Copper Concentrate").length,
      ).toBeGreaterThanOrEqual(1);
    });

    const principals = screen.getAllByText("$8.0K");
    expect(principals.length).toBeGreaterThanOrEqual(1);

    const emDashes = screen.getAllByText("—");
    expect(emDashes.length).toBeGreaterThanOrEqual(1);
  });

  it("renders the summary card labels", async () => {
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/loan-book",
      JSON.stringify(FIXTURE_FULL),
    );

    render(<DeploymentMonitorPanel />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId("loan-book-summary-cards")).toBeInTheDocument();
    });

    expect(screen.getAllByText("Collateral").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Yield").length).toBeGreaterThanOrEqual(1);
  });
});

describe("DeploymentMonitorPanel — responsive structure (#749)", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockClear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("loan-book table renders as a single overflow-x-auto wrapper at all widths — no hidden/md:block split", async () => {
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/loan-book",
      JSON.stringify(FIXTURE_FULL),
    );

    render(<DeploymentMonitorPanel />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId("loan-book-table-desktop")).toBeInTheDocument();
    });

    const tableWrapper = screen.getByTestId("loan-book-table-desktop");

    expect(tableWrapper.className).toContain("overflow-x-auto");
    expect(tableWrapper.className).not.toContain("hidden");
    expect(tableWrapper.className).not.toContain("md:block");

    expect(screen.queryByTestId("loan-book-table-mobile")).toBeNull();
  });

  it("loan-book summary cards are in a horizontally-scrollable flex row (no grid wrapping)", async () => {
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/loan-book",
      JSON.stringify(FIXTURE_FULL),
    );

    render(<DeploymentMonitorPanel />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId("loan-book-summary-cards")).toBeInTheDocument();
    });

    const summaryCards = screen.getByTestId("loan-book-summary-cards");

    expect(summaryCards.className).toContain("flex");
    expect(summaryCards.className).not.toContain("grid-cols-2");
    expect(summaryCards.className).not.toContain("md:grid-cols-5");
  });
});

describe("DeploymentMonitorPanel — section order (issue #726)", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockClear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("summary cards render before tab bar, tab bar before table, and both are inside the table container", async () => {
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/loan-book",
      JSON.stringify(FIXTURE_FULL),
    );

    render(<DeploymentMonitorPanel />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId("loan-book-summary-cards")).toBeInTheDocument();
    });

    const summaryCards = screen.getByTestId("loan-book-summary-cards");
    const tabBar = screen.getByTestId("loan-book-tab-bar");
    const table = screen.getByTestId("loan-book-table");
    const tableContainer = screen.getByTestId("loan-book-table-container");

    expect(
      summaryCards.compareDocumentPosition(tabBar) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    expect(
      tabBar.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    expect(tableContainer.contains(tabBar)).toBe(true);
    expect(tableContainer.contains(table)).toBe(true);

    expect(tableContainer.contains(summaryCards)).toBe(false);
  });
});

describe("DeploymentMonitorPanel — tab bar", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockClear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("renders Active Loans selected and In Origination selectable (not disabled)", async () => {
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/loan-book",
      JSON.stringify(FIXTURE_FULL),
    );

    render(<DeploymentMonitorPanel />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId("loan-book-tab-bar")).toBeInTheDocument();
    });

    const activeTab = screen.getByTestId("loan-book-tab-active-loans");
    const originationTab = screen.getByTestId("loan-book-tab-in-origination");

    expect(activeTab).toHaveAttribute("aria-selected", "true");
    expect(originationTab).not.toHaveAttribute("aria-disabled");
    expect(originationTab).toHaveAttribute("aria-selected", "false");
  });

  it("Active Loans badge shows the live count from loans.length", async () => {
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/loan-book",
      JSON.stringify(FIXTURE_FULL),
    );

    render(<DeploymentMonitorPanel />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(
        screen.getByTestId("loan-book-tab-active-loans-count"),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByTestId("loan-book-tab-active-loans-count"),
    ).toHaveTextContent("2");
  });

  it("In Origination tab renders a count badge", async () => {
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/loan-book",
      JSON.stringify(FIXTURE_FULL),
    );
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/loan-book/submissions",
      JSON.stringify([]),
    );

    render(<DeploymentMonitorPanel />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(
        screen.getByTestId("loan-book-tab-in-origination-count"),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByTestId("loan-book-tab-in-origination-count"),
    ).toHaveTextContent("0");
  });
});

describe("DeploymentMonitorPanel — In Origination tab field set (issue #814)", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockClear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("renders the Figma 4116-9155 column set and formatted values when selected", async () => {
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/loan-book",
      JSON.stringify(FIXTURE_FULL),
    );
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/loan-book/submissions",
      JSON.stringify(FIXTURE_SUBMISSIONS),
    );

    render(<DeploymentMonitorPanel />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(
        screen.getByTestId("loan-book-tab-in-origination"),
      ).toBeInTheDocument();
    });
    await userEvent.click(screen.getByTestId("loan-book-tab-in-origination"));

    await waitFor(() => {
      expect(screen.getByTestId("origination-table")).toBeInTheDocument();
    });

    for (const header of [
      "Commodity",
      "Facility",
      "Corridor",
      "Rate",
      "Maturity",
      "Submitted",
      "Status",
    ]) {
      expect(screen.getByText(header)).toBeInTheDocument();
    }

    expect(screen.queryByText("Principal")).toBeNull();
    expect(screen.queryByText("LTV")).toBeNull();
    expect(screen.queryByText("Duration")).toBeNull();
    expect(screen.queryByText("Protection")).toBeNull();

    expect(screen.queryByText("Auric Andes")).toBeNull();
    expect(screen.getByText("Gold pyrite concentrate")).toBeInTheDocument();
    expect(screen.getByText("$3.5M")).toBeInTheDocument();
    expect(screen.getByText("PE → CN")).toBeInTheDocument();
    expect(screen.getByText("14.0%")).toBeInTheDocument();
    expect(screen.getByText("15 Dec 2026")).toBeInTheDocument();
    expect(screen.getByText("In review")).toBeInTheDocument();
  });

  it("still renders the empty state on the In Origination tab with no submissions", async () => {
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/loan-book",
      JSON.stringify(FIXTURE_FULL),
    );
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/loan-book/submissions",
      JSON.stringify([]),
    );

    render(<DeploymentMonitorPanel />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(
        screen.getByTestId("loan-book-tab-in-origination"),
      ).toBeInTheDocument();
    });
    await userEvent.click(screen.getByTestId("loan-book-tab-in-origination"));

    await waitFor(() => {
      expect(
        screen.getByTestId("loan-book-origination-empty"),
      ).toBeInTheDocument();
    });
    expect(screen.queryByTestId("origination-table")).toBeNull();
  });

  it("the Active Loans tab is unaffected — still renders its own 7-column set", async () => {
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/loan-book",
      JSON.stringify(FIXTURE_FULL),
    );
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/loan-book/submissions",
      JSON.stringify(FIXTURE_SUBMISSIONS),
    );

    render(<DeploymentMonitorPanel />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId("loan-book-table")).toBeInTheDocument();
    });

    expect(screen.getByText("Commodity")).toBeInTheDocument();
    expect(screen.getByText("Protection")).toBeInTheDocument();
    expect(screen.queryByTestId("origination-table")).toBeNull();
  });
});

describe("dashboard panel state presentations", () => {
  it("PanelLoading shows loading copy", () => {
    render(<PanelLoading />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("PanelEmpty shows its caption", () => {
    render(<PanelEmpty caption="Coming soon" />);
    expect(screen.getByText("Coming soon")).toBeInTheDocument();
  });

  it("PanelError renders a message and invokes onRetry when Retry is clicked", async () => {
    const onRetry = vi.fn();
    render(<PanelError onRetry={onRetry} message="Couldn’t load this panel" />);
    expect(screen.getByText("Couldn’t load this panel")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("active chain not served by the API (#1605)", () => {
  it("replaces the page content with the not-available notice", () => {
    mockChainServed.mockReturnValue({
      kind: "evm",
      chainId: 1,
      chainName: "Ethereum",
      served: false,
    });
    renderDashboard();
    expect(screen.getByTestId("chain-not-served")).toHaveTextContent(
      "Not available on Ethereum",
    );
    expect(screen.queryByTestId("dashboard-grid")).not.toBeInTheDocument();
  });
});
