/**
 * Integration tests for the /transactions route.
 *
 * `useRequests` and `useWallet` are mocked to return controlled fixture data.
 * This avoids importing wagmi/AppKit and their network side effects, while
 * still exercising the full rendering and filtering logic of the Transactions
 * page.
 *
 * The API module itself (client, useRequests) is tested separately in
 * `src/api/useRequests.test.tsx` and `src/api/client.test.ts`.
 *
 * Scenarios covered:
 *   1. Default "Buy" tab renders only Deposit rows.
 *   2. Switching tabs filters in place.
 *   3. The "All" tab is absent.
 *   4. Wallet-level empty (zero rows) → illustration + caption render.
 *   5. Wallet-level empty (disconnected) → illustration + caption render.
 *   6. Tab-level empty (API has rows but active tab yields zero) → illustration + caption render, "No {tab} activity yet" absent.
 *   7. Error state renders "Couldn't load activity" + Retry button.
 *   8. Loading state renders "Loading…".
 *   9. Formatting assertions — amount strings appear in the rendered output.
 *  10. Timestamp shape assertion.
 *  11. Active-chain gating (Issue #644): Stellar view keys off Stellar connection;
 *      EVM view keys off EVM connection; empty state and rows are mutually exclusive.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route } from "./transactions";
import type { RequestsResponse, RequestItem } from "@/api";
import { renderRequestRow } from "@/components/activity/renderRequestRow";

// ── Mock @/api ────────────────────────────────────────────────────────────────
// We mock the entire api module so useRequests returns controlled data. This
// avoids any network/wagmi/AppKit initialization in the test environment.

const mockRefetch = vi.fn();

const mockUseRequests = vi.fn(() => ({
  data: undefined as RequestsResponse | undefined,
  isLoading: false,
  error: null as Error | null,
  refetch: mockRefetch,
}));

vi.mock("@/api", () => ({
  useRequests: () => mockUseRequests(),
}));

// ── Mock @/wallet ─────────────────────────────────────────────────────────────
// We mock useWallet so the component can import it without pulling in
// wagmi/AppKit. We preserve all other exports (e.g. formatUnits) via
// importOriginal so format helpers still work in tests.
//
// All three hooks required for active-chain gating (Issue #644) are mocked:
//   - useEvmWallet (mockUseWallet) — defaults connected
//   - useStellarWallet (mockUseStellarWallet) — defaults disconnected
//   - useWalletView (mockUseWalletView) — defaults { kind: "evm" }

const mockUseWallet = vi.fn(() => ({ isConnected: true }));
const mockUseStellarWallet = vi.fn(() => ({ isConnected: false }));
const mockUseWalletView = vi.fn(() => ({ kind: "evm" as "evm" | "stellar" }));

vi.mock("@/wallet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/wallet")>();
  return {
    ...actual,
    useEvmWallet: () => mockUseWallet(),
    useStellarWallet: () => mockUseStellarWallet(),
    useWalletView: () => mockUseWalletView(),
  };
});

// ── TanStack Router mock ──────────────────────────────────────────────────────

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...original,
    useNavigate: vi.fn(() => vi.fn()),
    useRouterState: vi.fn(() => "/transactions"),
    createFileRoute: original.createFileRoute,
    Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

// ── Constants ─────────────────────────────────────────────────────────────────

// Stellar-specific fixture — a single Deposit row returned by useRequests when
// the Stellar wallet is active and connected.
// Amount encoded at 7 decimals (SAC_DECIMALS): 20000000000 = 2,000 USDC.
const STELLAR_FIXTURE: RequestsResponse = {
  requests: [
    {
      type: "Deposit",
      amount: "20000000000", // 2,000 USDC at 7 decimals (SAC_DECIMALS)
      request_id: "stellar-1",
      status: "Completed",
      created_at: "2026-05-16T10:00:00Z",
    },
  ],
};

const FIXTURE: RequestsResponse = {
  requests: [
    {
      type: "Deposit",
      amount: "1000000000", // 1,000 USDC at 6 decimals
      request_id: "1",
      status: "Completed",
      created_at: "2026-05-15T12:00:00Z",
    },
    {
      type: "Withdraw",
      amount: "1000000000", // 1,000 USDC at 6 decimals
      request_id: "2",
      status: "PendingClaim",
      created_at: "2026-05-14T09:30:00Z",
    },
    {
      type: "Stake",
      amount: "1000000000000000000000", // 1,000 PLUSD at 18 decimals
      assets: "1000000000000000000000",
      shares: "999500000000000000000", // 999.5 sPLUSD at 18 decimals
      status: "Completed",
      created_at: "2026-05-13T18:00:00Z",
    },
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderTransactions() {
  const TransactionsPage = Route.options.component as React.ComponentType;
  return render(<TransactionsPage />);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Transactions page — responsive layout (Issue #523)", () => {
  beforeEach(() => {
    mockRefetch.mockClear();
    mockUseWallet.mockReturnValue({ isConnected: true });
    mockUseStellarWallet.mockReturnValue({ isConnected: false });
    mockUseWalletView.mockReturnValue({ kind: "evm" });
    mockUseRequests.mockReturnValue({
      data: FIXTURE,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("<main> carries px-2 class for 8px mobile side margins", () => {
    const { container } = renderTransactions();
    const main = container.querySelector("main");
    expect(main).not.toBeNull();
    expect(main?.className).toContain("px-2");
  });
});

describe("Transactions page — mobile empty-state layout (Issue #524)", () => {
  beforeEach(() => {
    mockUseWallet.mockReturnValue({ isConnected: true });
    mockUseStellarWallet.mockReturnValue({ isConnected: false });
    mockUseWalletView.mockReturnValue({ kind: "evm" });
    mockUseRequests.mockReturnValue({
      data: { requests: [] },
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("empty-state wrapper uses pt-8 for mobile top-anchoring and md:min-h-[400px] md:justify-center for desktop centering", () => {
    const { container } = renderTransactions();
    // The outer wrapper div surrounds the EmptyState — find it via the unique
    // pt-8 class applied to it in transactions.tsx.
    const wrapper = container.querySelector("[class*='pt-8']");
    expect(wrapper).not.toBeNull();
    expect(wrapper?.className).toContain("pt-8");
    expect(wrapper?.className).toContain("md:min-h-[400px]");
    expect(wrapper?.className).toContain("md:justify-center");
    expect(wrapper?.className).toContain("md:pt-0");
  });
});

describe("Transactions page — default Buy tab", () => {
  beforeEach(() => {
    mockRefetch.mockClear();
    mockUseWallet.mockReturnValue({ isConnected: true });
    mockUseStellarWallet.mockReturnValue({ isConnected: false });
    mockUseWalletView.mockReturnValue({ kind: "evm" });
    mockUseRequests.mockReturnValue({
      data: FIXTURE,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders without throwing", () => {
    expect(() => renderTransactions()).not.toThrow();
  });

  it("shows the Deposit (Buy) row's formatted amount under the default Buy tab", () => {
    renderTransactions();
    expect(screen.getByText("+1,000.00 USDC")).toBeInTheDocument();
  });

  it("does not show Withdraw amount under the Buy tab", () => {
    renderTransactions();

    expect(screen.getByText("+1,000.00 USDC")).toBeInTheDocument();
    expect(screen.getAllByText("+1,000.00 USDC")).toHaveLength(1);
  });
});

describe("Transactions page — tab switching", () => {
  beforeEach(() => {
    mockUseWallet.mockReturnValue({ isConnected: true });
    mockUseStellarWallet.mockReturnValue({ isConnected: false });
    mockUseWalletView.mockReturnValue({ kind: "evm" });
    mockUseRequests.mockReturnValue({
      data: FIXTURE,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("clicking Sell shows the Withdraw row", async () => {
    const user = userEvent.setup();
    renderTransactions();

    const sellTab = screen.getByRole("tab", { name: "Sell" });
    await user.click(sellTab);

    expect(screen.getByText("+1,000.00 USDC")).toBeInTheDocument();
  });

  it("clicking Stake shows the Stake row", async () => {
    const user = userEvent.setup();
    renderTransactions();

    const stakeTab = screen.getByRole("tab", { name: "Stake" });
    await user.click(stakeTab);

    expect(screen.getByText("−1,000.00 PLUSD")).toBeInTheDocument();
  });
});

describe("Transactions page — All tab is absent", () => {
  beforeEach(() => {
    mockUseWallet.mockReturnValue({ isConnected: true });
    mockUseStellarWallet.mockReturnValue({ isConnected: false });
    mockUseWalletView.mockReturnValue({ kind: "evm" });
    mockUseRequests.mockReturnValue({
      data: FIXTURE,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not render an 'All' tab", () => {
    renderTransactions();

    expect(screen.queryByRole("tab", { name: "All" })).not.toBeInTheDocument();
  });
});

describe("Transactions page — wallet-level empty state (zero rows)", () => {
  beforeEach(() => {
    mockUseWallet.mockReturnValue({ isConnected: true });
    mockUseStellarWallet.mockReturnValue({ isConnected: false });
    mockUseWalletView.mockReturnValue({ kind: "evm" });
    mockUseRequests.mockReturnValue({
      data: { requests: [] },
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the illustration caption when request list is empty", () => {
    renderTransactions();

    expect(
      screen.getByText("You will see all transactions here"),
    ).toBeInTheDocument();
  });

  it("does not render the bare 'No activity yet' text when request list is empty", () => {
    renderTransactions();

    expect(screen.queryByText("No activity yet")).not.toBeInTheDocument();
  });
});

describe("Transactions page — tab-level empty state", () => {
  beforeEach(() => {
    mockUseWallet.mockReturnValue({ isConnected: true });
    mockUseStellarWallet.mockReturnValue({ isConnected: false });
    mockUseWalletView.mockReturnValue({ kind: "evm" });
    // Data has one Deposit row (maps to Buy tab). Sell tab will yield zero rows.
    mockUseRequests.mockReturnValue({
      data: {
        requests: [
          {
            type: "Deposit",
            amount: "1000000000",
            request_id: "1",
            status: "Completed",
            created_at: "2026-05-15T12:00:00Z",
          },
        ],
      },
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the illustration + caption when Sell tab has no rows", async () => {
    const user = userEvent.setup();
    renderTransactions();

    const sellTab = screen.getByRole("tab", { name: "Sell" });
    await user.click(sellTab);

    expect(
      screen.getByText("You will see all transactions here"),
    ).toBeInTheDocument();
  });

  it("does not render the stale 'No Sell activity yet' text", async () => {
    const user = userEvent.setup();
    renderTransactions();

    const sellTab = screen.getByRole("tab", { name: "Sell" });
    await user.click(sellTab);

    expect(screen.queryByText(/No Sell activity yet/i)).not.toBeInTheDocument();
  });
});

describe("Transactions page — loading state", () => {
  beforeEach(() => {
    mockUseWallet.mockReturnValue({ isConnected: true });
    mockUseStellarWallet.mockReturnValue({ isConnected: false });
    mockUseWalletView.mockReturnValue({ kind: "evm" });
    mockUseRequests.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: mockRefetch,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders 'Loading…' while data is loading", () => {
    renderTransactions();

    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });
});

describe("Transactions page — error state", () => {
  beforeEach(() => {
    mockUseWallet.mockReturnValue({ isConnected: true });
    mockUseStellarWallet.mockReturnValue({ isConnected: false });
    mockUseWalletView.mockReturnValue({ kind: "evm" });
    mockUseRequests.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("Network error"),
      refetch: mockRefetch,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders 'Couldn't load activity' and a Retry button on error", () => {
    renderTransactions();

    expect(screen.getByText(/Couldn't load activity/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument();
  });

  it("clicking Retry calls refetch", async () => {
    const user = userEvent.setup();
    renderTransactions();

    const retryBtn = screen.getByRole("button", { name: /Retry/i });
    await user.click(retryBtn);

    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });
});

describe("Transactions page — disconnected wallet (no data)", () => {
  beforeEach(() => {
    mockUseWallet.mockReturnValue({ isConnected: false });
    mockUseStellarWallet.mockReturnValue({ isConnected: false });
    mockUseWalletView.mockReturnValue({ kind: "evm" });
    mockUseRequests.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the illustration caption when wallet is disconnected", () => {
    renderTransactions();

    expect(
      screen.getByText("You will see all transactions here"),
    ).toBeInTheDocument();
  });

  it("does not render loading or error states when wallet is disconnected", () => {
    renderTransactions();

    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Couldn't load activity/),
    ).not.toBeInTheDocument();
  });
});

describe("Transactions page — formatting assertions", () => {
  beforeEach(() => {
    mockUseWallet.mockReturnValue({ isConnected: true });
    mockUseStellarWallet.mockReturnValue({ isConnected: false });
    mockUseWalletView.mockReturnValue({ kind: "evm" });
    mockUseRequests.mockReturnValue({
      data: FIXTURE,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("formats Deposit amount as '+1,000.00 USDC'", () => {
    renderTransactions();

    expect(screen.getByText("+1,000.00 USDC")).toBeInTheDocument();
  });

  it("formats Withdraw amount as '+1,000.00 USDC' on Sell tab", async () => {
    const user = userEvent.setup();
    renderTransactions();

    const sellTab = screen.getByRole("tab", { name: "Sell" });
    await user.click(sellTab);

    expect(screen.getByText("+1,000.00 USDC")).toBeInTheDocument();
  });

  it("formats Stake amounts on Stake tab", async () => {
    const user = userEvent.setup();
    renderTransactions();

    const stakeTab = screen.getByRole("tab", { name: "Stake" });
    await user.click(stakeTab);

    expect(screen.getByText("−1,000.00 PLUSD")).toBeInTheDocument();
    expect(screen.getByText("+999.50 sPLUSD")).toBeInTheDocument();
  });

  it("renders timestamps matching the shape Mon DD, H:MM AM/PM", () => {
    renderTransactions();

    const container = document.body.textContent ?? "";
    expect(container).toMatch(/[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} (AM|PM)/);
  });
});

describe("Transactions page — active chain gating (Issue #644)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("Stellar view + Stellar connected + Stellar rows → rows render and empty-state caption is absent (the bug)", () => {
    // Repro: with Stellar active and connected and EVM disconnected,
    // the old code would show BOTH rows AND the empty state. After the fix,
    // only rows should be visible.
    mockUseWalletView.mockReturnValue({ kind: "stellar" });
    mockUseStellarWallet.mockReturnValue({ isConnected: true });
    mockUseWallet.mockReturnValue({ isConnected: false }); // EVM disconnected
    mockUseRequests.mockReturnValue({
      data: STELLAR_FIXTURE,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    });

    renderTransactions();

    // Rows must render
    expect(screen.getByText("+2,000.00 USDC")).toBeInTheDocument();
    // Empty-state caption must NOT render simultaneously (mutual exclusivity)
    expect(
      screen.queryByText("You will see all transactions here"),
    ).not.toBeInTheDocument();
  });

  it("Stellar view + Stellar disconnected + no data → empty state renders, no rows", () => {
    mockUseWalletView.mockReturnValue({ kind: "stellar" });
    mockUseStellarWallet.mockReturnValue({ isConnected: false });
    mockUseWallet.mockReturnValue({ isConnected: true }); // EVM connected but not active
    mockUseRequests.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    });

    renderTransactions();

    expect(
      screen.getByText("You will see all transactions here"),
    ).toBeInTheDocument();
    expect(screen.queryByText("+2,000.00 USDC")).not.toBeInTheDocument();
  });

  it("EVM view + EVM disconnected + Stellar connected with data → empty state (active chain is EVM, disconnected)", () => {
    mockUseWalletView.mockReturnValue({ kind: "evm" });
    mockUseWallet.mockReturnValue({ isConnected: false }); // EVM disconnected
    mockUseStellarWallet.mockReturnValue({ isConnected: true }); // Stellar connected but not active
    mockUseRequests.mockReturnValue({
      data: STELLAR_FIXTURE, // useRequests is mocked; gate keys off EVM here
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    });

    renderTransactions();

    // EVM view is active but EVM is disconnected → empty state
    expect(
      screen.getByText("You will see all transactions here"),
    ).toBeInTheDocument();
  });

  it("mutual exclusivity: rows and empty-state never render simultaneously (EVM connected with data)", () => {
    mockUseWalletView.mockReturnValue({ kind: "evm" });
    mockUseWallet.mockReturnValue({ isConnected: true });
    mockUseStellarWallet.mockReturnValue({ isConnected: false });
    mockUseRequests.mockReturnValue({
      data: FIXTURE,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    });

    renderTransactions();

    const emptyCaption = screen.queryByText(
      "You will see all transactions here",
    );
    const rows = screen.queryAllByTestId(/^transactions-row-/);

    // Either rows render and empty-state does not, or vice versa — never both
    if (rows.length > 0) {
      expect(emptyCaption).not.toBeInTheDocument();
    } else {
      expect(emptyCaption).toBeInTheDocument();
    }
  });
});

describe("Shared renderRequestRow helper — contract", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns a non-null React element for each FIXTURE row", () => {
    FIXTURE.requests.forEach((item: RequestItem) => {
      const node = renderRequestRow(item, "evm");
      expect(node).not.toBeNull();
      expect(React.isValidElement(node)).toBe(true);
    });
  });

  it("returns a non-null element for a pending Deposit row", () => {
    const pendingDeposit: RequestItem = {
      type: "Deposit",
      amount: "500000000",
      request_id: "99",
      status: "PendingVerification",
      created_at: "2026-05-01T10:00:00Z",
    };
    const node = renderRequestRow(pendingDeposit, "evm");
    expect(node).not.toBeNull();
    expect(React.isValidElement(node)).toBe(true);
  });

  it("returns a non-null element for an Unstake row", () => {
    const unstake: RequestItem = {
      type: "Unstake",
      amount: "500000000000000000000",
      assets: "500000000000000000000",
      shares: "499750000000000000000",
      request_id: "100",
      status: "Completed",
      created_at: "2026-05-02T10:00:00Z",
    };
    const node = renderRequestRow(unstake, "evm");
    expect(node).not.toBeNull();
    expect(React.isValidElement(node)).toBe(true);
  });

  it("renders Stake with correct PLUSD and sPLUSD amounts when assets and shares are present", () => {
    const stake: RequestItem = {
      type: "Stake",
      amount: "1000000000000000000000",
      assets: "1000000000000000000000",
      shares: "999500000000000000000",
      status: "Completed",
      created_at: "2026-05-03T10:00:00Z",
    };
    const { container } = render(<>{renderRequestRow(stake, "evm")}</>);
    expect(container.textContent).toContain("−1,000.00 PLUSD");
    expect(container.textContent).toContain("+999.50 sPLUSD");
  });

  it("renders Unstake with correct PLUSD and sPLUSD amounts when assets and shares are present", () => {
    const unstake: RequestItem = {
      type: "Unstake",
      amount: "500000000000000000000",
      assets: "500000000000000000000",
      shares: "499750000000000000000",
      status: "Completed",
      created_at: "2026-05-04T10:00:00Z",
    };
    const { container } = render(<>{renderRequestRow(unstake, "evm")}</>);
    expect(container.textContent).toContain("+500.00 PLUSD");
    expect(container.textContent).toContain("−499.75 sPLUSD");
  });

  it("renders Stake with em-dash when assets is missing (fail-loud)", () => {
    const stake: RequestItem = {
      type: "Stake",
      amount: "1000000000000000000000",
      // assets and shares intentionally omitted — simulates missing API fields
      status: "Completed",
      created_at: "2026-05-05T10:00:00Z",
    };
    const { container } = render(<>{renderRequestRow(stake, "evm")}</>);
    // Both lines should show em-dash, not zero
    const text = container.textContent ?? "";
    expect(text).toContain("−— PLUSD");
    expect(text).toContain("+— sPLUSD");
    expect(text).not.toContain("0.00");
  });

  it("renders Unstake with em-dash when assets is missing (fail-loud)", () => {
    const unstake: RequestItem = {
      type: "Unstake",
      amount: "500000000000000000000",
      // assets and shares intentionally omitted — simulates missing API fields
      status: "Completed",
      created_at: "2026-05-06T10:00:00Z",
    };
    const { container } = render(<>{renderRequestRow(unstake, "evm")}</>);
    const text = container.textContent ?? "";
    expect(text).toContain("+— PLUSD");
    expect(text).toContain("−— sPLUSD");
    expect(text).not.toContain("0.00");
  });

  it("renders Stake with em-dash for shares when only shares is missing (fail-loud)", () => {
    const stake: RequestItem = {
      type: "Stake",
      amount: "1000000000000000000000",
      assets: "1000000000000000000000",
      // shares intentionally omitted
      status: "Completed",
      created_at: "2026-05-07T10:00:00Z",
    };
    const { container } = render(<>{renderRequestRow(stake, "evm")}</>);
    const text = container.textContent ?? "";
    expect(text).toContain("−1,000.00 PLUSD");
    expect(text).toContain("+— sPLUSD");
    expect(text).not.toContain("+0.00 sPLUSD");
  });
});

describe("Transactions page — Stellar decimals (Issue #674)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // Stellar fixture: amounts encoded at 7 decimals (SAC_DECIMALS).
  // 10_000_000 = 1.0 at 7 dp; 9_900_000 = 0.99 at 7 dp.
  const STELLAR_7DP: RequestsResponse = {
    requests: [
      {
        type: "Deposit",
        amount: "10000000", // 1.0 USDC at 7 decimals
        request_id: "s1",
        status: "Completed",
        created_at: "2026-06-01T10:00:00Z",
      },
      {
        type: "Stake",
        amount: "10000000",
        assets: "10000000", // 1.0 PLUSD at 7 decimals
        shares: "9900000",  // 0.99 sPLUSD at 7 decimals
        status: "Completed",
        created_at: "2026-06-01T11:00:00Z",
      },
    ],
  };

  it("Stellar Deposit: 10000000 at 7 dp renders '1.00 USDC', not '10.00 USDC' (the bug)", () => {
    mockUseWalletView.mockReturnValue({ kind: "stellar" });
    mockUseStellarWallet.mockReturnValue({ isConnected: true });
    mockUseWallet.mockReturnValue({ isConnected: false });
    mockUseRequests.mockReturnValue({
      data: STELLAR_7DP,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    });

    renderTransactions();

    expect(screen.getByText("+1.00 USDC")).toBeInTheDocument();
    // Ensure the old bug value does NOT appear
    expect(screen.queryByText("+10.00 USDC")).not.toBeInTheDocument();
  });

  it("Stellar Stake: 10000000/9900000 at 7 dp renders non-zero PLUSD/sPLUSD amounts (the bug)", async () => {
    const user = userEvent.setup();
    mockUseWalletView.mockReturnValue({ kind: "stellar" });
    mockUseStellarWallet.mockReturnValue({ isConnected: true });
    mockUseWallet.mockReturnValue({ isConnected: false });
    mockUseRequests.mockReturnValue({
      data: STELLAR_7DP,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    });

    renderTransactions();

    const stakeTab = screen.getByRole("tab", { name: "Stake" });
    await user.click(stakeTab);

    expect(screen.getByText("−1.00 PLUSD")).toBeInTheDocument();
    expect(screen.getByText("+0.99 sPLUSD")).toBeInTheDocument();
    // Ensure the old bug value (18-dp scale → effectively 0) does NOT appear
    expect(screen.queryByText("−0.00 PLUSD")).not.toBeInTheDocument();
  });

  it("EVM regression: EVM Deposit at 6 dp still renders correctly after the fix", () => {
    mockUseWalletView.mockReturnValue({ kind: "evm" });
    mockUseWallet.mockReturnValue({ isConnected: true });
    mockUseStellarWallet.mockReturnValue({ isConnected: false });
    mockUseRequests.mockReturnValue({
      data: FIXTURE,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    });

    renderTransactions();

    expect(screen.getByText("+1,000.00 USDC")).toBeInTheDocument();
  });

  it("EVM regression: EVM Stake at 18 dp still renders correctly after the fix", async () => {
    const user = userEvent.setup();
    mockUseWalletView.mockReturnValue({ kind: "evm" });
    mockUseWallet.mockReturnValue({ isConnected: true });
    mockUseStellarWallet.mockReturnValue({ isConnected: false });
    mockUseRequests.mockReturnValue({
      data: FIXTURE,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    });

    renderTransactions();

    const stakeTab = screen.getByRole("tab", { name: "Stake" });
    await user.click(stakeTab);

    expect(screen.getByText("−1,000.00 PLUSD")).toBeInTheDocument();
    expect(screen.getByText("+999.50 sPLUSD")).toBeInTheDocument();
  });

  it("renderRequestRow — Stellar chainKind: 10000000 Deposit renders '+1.00 USDC'", () => {
    const deposit: RequestItem = {
      type: "Deposit",
      amount: "10000000",
      request_id: "s-d1",
      status: "Completed",
      created_at: "2026-06-01T10:00:00Z",
    };
    const { container } = render(<>{renderRequestRow(deposit, "stellar")}</>);
    expect(container.textContent).toContain("+1.00 USDC");
  });

  it("renderRequestRow — Stellar chainKind: 10000000/9900000 Stake renders non-zero PLUSD/sPLUSD", () => {
    const stake: RequestItem = {
      type: "Stake",
      amount: "10000000",
      assets: "10000000",
      shares: "9900000",
      status: "Completed",
      created_at: "2026-06-01T11:00:00Z",
    };
    const { container } = render(<>{renderRequestRow(stake, "stellar")}</>);
    expect(container.textContent).toContain("−1.00 PLUSD");
    expect(container.textContent).toContain("+0.99 sPLUSD");
  });
});
