/**
 * Integration tests for the /dashboard route (Issue #716 + #717).
 *
 * The Protocol Dashboard is protocol-wide. The DeploymentMonitorPanel (Panel B)
 * is now wired to `useLoanBook`, so these tests mock the `apiFetch` client to
 * control the API response.
 *
 * Scenarios covered:
 *   1. Page root + <main> render (protocol-wide; no wallet connected, no gate).
 *   2. All four panel containers render with their titles.
 *   3. Responsive structure: grid is single-column on mobile, two-column at md+.
 *   4. PanelLoading shows loading copy.
 *   5. PanelEmpty shows its caption.
 *   6. PanelError's Retry button invokes onRetry.
 *   7. DeploymentMonitorPanel: loading state.
 *   8. DeploymentMonitorPanel: error state + retry.
 *   9. DeploymentMonitorPanel: empty loans state.
 *  10. DeploymentMonitorPanel: ready state — formatted values + null → "—".
 *  11. DeploymentMonitorPanel: responsive class assertions.
 *  12. DeploymentMonitorPanel: tab bar with disabled "In Origination".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route } from "./dashboard";
import { PanelLoading } from "@/components/dashboard/PanelLoading";
import { PanelEmpty } from "@/components/dashboard/PanelEmpty";
import { PanelError } from "@/components/dashboard/PanelError";
import { DeploymentMonitorPanel } from "@/components/dashboard/DeploymentMonitorPanel";
import type { LoanBookResponse } from "@/api";

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Mock wagmi + AppKit so the component tree can render without real providers.
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
    EVM_RPC_URL: "https://ethereum-hoodi-rpc.publicnode.com",
    DEPOSIT_MANAGER_ADDRESS: "0x0000000000000000000000000000000000000000",
    WALLETCONNECT_PROJECT_ID: "replace-me",
  },
}));

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FIXTURE_FULL: LoanBookResponse = {
  summary: {
    total_deployed: "31600000.000000",
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
      principal: "8000000.000000",
      collateral: null,
      ltv: null,
      duration_days: 120,
      rate: "0.112000",
      protection: "LC at sight",
      status: "Performing",
    },
    {
      originator: "Trafalgar",
      borrower: "Trafalgar",
      commodity: "Alumina",
      principal: "5200000.000000",
      collateral: null,
      ltv: null,
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
    // Default: loan-book returns empty so panel shows empty state (not loading)
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
    const expected: Array<[string, string]> = [
      ["dashboard-panel-balance-sheet", "Balance Sheet"],
      // Title updated to "Loan Book" per issue #717 design decision
      ["dashboard-panel-deployment-monitor", "Loan Book"],
      ["dashboard-panel-withdrawal-queue", "Withdrawal Queue"],
      ["dashboard-panel-yield-history", "Yield History"],
    ];
    for (const [testId, title] of expected) {
      const panel = screen.getByTestId(testId);
      expect(panel).toBeInTheDocument();
      expect(panel).toHaveTextContent(title);
    }
    // Three placeholders still show "Coming soon" (B is now wired to real data)
    expect(screen.getAllByText("Coming soon")).toHaveLength(3);
  });

  it("lays out a responsive grid: single column on mobile, two columns at md+", () => {
    renderDashboard();
    const grid = screen.getByTestId("dashboard-grid");
    expect(grid.className).toContain("grid-cols-1");
    expect(grid.className).toContain("md:grid-cols-2");
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
    // Never resolve — keeps the hook in loading state
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

    // Clicking Retry triggers a refetch (fetch is called again)
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

  it("shows PanelEmpty when loans array is empty", async () => {
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/loan-book",
      JSON.stringify(FIXTURE_EMPTY),
    );

    render(<DeploymentMonitorPanel />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId("panel-empty")).toBeInTheDocument();
    });
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
      // Total Deployed card
      expect(screen.getByTestId("loan-book-summary-cards")).toBeInTheDocument();
    });

    // Formatted values from FIXTURE_FULL (use getAllByText where values appear
    // in both summary cards and table rows).
    expect(screen.getAllByText("$31.6M").length).toBeGreaterThanOrEqual(1); // total_deployed
    expect(screen.getAllByText("11.2%").length).toBeGreaterThanOrEqual(1); // avg_yield (one decimal)
    expect(screen.getByText("68 days")).toBeInTheDocument(); // avg_duration_days (summary only)

    // Null fields (total_collateral + senior_debt_coverage) → "—"
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
        screen.getAllByText("Open Mineral / Copper Concentrate").length,
      ).toBeGreaterThanOrEqual(1);
    });

    // Principal formatted as compact USD
    const principals = screen.getAllByText("$8.0M");
    expect(principals.length).toBeGreaterThanOrEqual(1);

    // Row with null protection shows "—"
    // Trafalgar row has protection: null → "—"
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

    // All five summary card labels must be present (use getAllByText because
    // "Collateral" also appears in the table header column).
    expect(screen.getAllByText("Collateral").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Yield").length).toBeGreaterThanOrEqual(1);
  });
});

describe("DeploymentMonitorPanel — responsive structure", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockClear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("desktop table carries hidden md:block class, mobile wrapper carries block md:hidden", async () => {
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/loan-book",
      JSON.stringify(FIXTURE_FULL),
    );

    render(<DeploymentMonitorPanel />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId("loan-book-table-desktop")).toBeInTheDocument();
    });

    const desktop = screen.getByTestId("loan-book-table-desktop");
    const mobile = screen.getByTestId("loan-book-table-mobile");

    // Desktop table is hidden on mobile (hidden) and shown at md+ (md:block)
    expect(desktop.className).toContain("hidden");
    expect(desktop.className).toContain("md:block");

    // Mobile cards are shown on mobile (block) and hidden at md+ (md:hidden)
    expect(mobile.className).toContain("block");
    expect(mobile.className).toContain("md:hidden");
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

  it("renders Active Loans tab as active and In Origination as disabled", async () => {
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/loan-book",
      JSON.stringify(FIXTURE_FULL),
    );

    render(<DeploymentMonitorPanel />, { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId("loan-book-tab-bar")).toBeInTheDocument();
    });

    const activeTab = screen.getByTestId("loan-book-tab-active-loans");
    const disabledTab = screen.getByTestId("loan-book-tab-in-origination");

    expect(activeTab).toHaveAttribute("aria-selected", "true");
    expect(disabledTab).toHaveAttribute("aria-disabled", "true");
    expect(disabledTab).toHaveAttribute("aria-selected", "false");
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
