/**
 * Unit tests for RecentActivityCard.
 *
 * `useRequests` is mocked to return controlled fixture data. `useWallet` is
 * mocked to provide a configurable `isConnected` flag. TanStack Router's
 * `Link` is replaced with a passthrough `<a href={to}>` so assertions can
 * check the href attribute.
 *
 * Scenarios covered:
 *   1. Disconnected → empty state renders; no "View All" link.
 *   2. Connected + 3 rows → three list items render with correct amount
 *      strings; "View All" button-link present and points to /transactions.
 *   3. Connected + 6 rows → exactly 5 rows render (MAX_ROWS cap).
 *   4. Connected + empty list → empty state renders; no "View All" link.
 *   5. Connected + loading → empty state renders; no "View All" link.
 *   6. Connected + error → empty state renders; no "View All" link.
 *   7. Active-chain gating (Issue #644): Stellar view + Stellar connected + data
 *      → list renders, empty state absent. EVM connection state no longer drives
 *      the card when Stellar is active.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { RecentActivityCard } from "./RecentActivityCard";
import type { RequestsResponse } from "@/api";

// ── Mock @/api ────────────────────────────────────────────────────────────────

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
// All three hooks required for active-chain gating (Issue #644) are mocked:
//   - useEvmWallet (mockUseWallet) — defaults disconnected
//   - useStellarWallet (mockUseStellarWallet) — defaults disconnected
//   - useWalletView (mockUseWalletView) — defaults { kind: "evm" }

const mockUseWallet = vi.fn(() => ({
  isConnected: false,
  address: undefined as string | undefined,
  disconnect: vi.fn(),
  openConnectModal: vi.fn(),
}));
const mockUseStellarWallet = vi.fn(() => ({
  isConnected: false,
  address: undefined as string | undefined,
}));
const mockUseWalletView = vi.fn(() => ({ kind: "evm" as "evm" | "stellar" }));

vi.mock("@/wallet", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/wallet")>();
  return {
    ...original,
    useEvmWallet: () => mockUseWallet(),
    useStellarWallet: () => mockUseStellarWallet(),
    useWalletView: () => mockUseWalletView(),
  };
});

// ── TanStack Router mock ──────────────────────────────────────────────────────
// Render Link as a passthrough <a href={to}> so tests can assert the href.

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...original,
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
  };
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FIXTURE_3: RequestsResponse = {
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

const FIXTURE_5: RequestsResponse = {
  requests: [
    ...FIXTURE_3.requests,
    {
      type: "Deposit",
      amount: "2000000000", // 2,000 USDC at 6 decimals
      request_id: "4",
      status: "Completed",
      created_at: "2026-05-12T10:00:00Z",
    },
    {
      type: "Withdraw",
      amount: "3000000000", // 3,000 USDC at 6 decimals
      request_id: "5",
      status: "Completed",
      created_at: "2026-05-11T08:00:00Z",
    },
  ],
};

// 6-item fixture used to verify the MAX_ROWS=5 cap: the 6th item must not
// render.
const FIXTURE_6: RequestsResponse = {
  requests: [
    ...FIXTURE_5.requests,
    {
      type: "Deposit",
      amount: "4000000000", // 4,000 USDC at 6 decimals
      request_id: "6",
      status: "Completed",
      created_at: "2026-05-10T07:00:00Z",
    },
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderCard() {
  return render(<RecentActivityCard />);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("RecentActivityCard — disconnected wallet", () => {
  beforeEach(() => {
    mockUseWalletView.mockReturnValue({ kind: "evm" });
    mockUseWallet.mockReturnValue({
      isConnected: false,
      address: undefined,
      disconnect: vi.fn(),
      openConnectModal: vi.fn(),
    });
    mockUseStellarWallet.mockReturnValue({ isConnected: false, address: undefined });
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

  it("renders the 'Recent activity' heading", () => {
    renderCard();
    expect(screen.getByText("Recent activity")).toBeInTheDocument();
  });

  it("renders the empty-state caption", () => {
    renderCard();
    expect(
      screen.getByText("You will see all transactions here"),
    ).toBeInTheDocument();
  });

  it("does not render the 'View All' link", () => {
    renderCard();
    expect(screen.queryByText(/View All/)).not.toBeInTheDocument();
  });
});

describe("RecentActivityCard — connected + 3 rows", () => {
  beforeEach(() => {
    mockUseWalletView.mockReturnValue({ kind: "evm" });
    mockUseWallet.mockReturnValue({
      isConnected: true,
      address: "0x1234",
      disconnect: vi.fn(),
      openConnectModal: vi.fn(),
    });
    mockUseStellarWallet.mockReturnValue({ isConnected: false, address: undefined });
    mockUseRequests.mockReturnValue({
      data: FIXTURE_3,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders three list items", () => {
    renderCard();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("renders the Deposit (Buy) amount string", () => {
    renderCard();
    // Deposit receives PLUSD (1:1 mint from USDC); label is PLUSD, not USDC
    expect(screen.getByText("+1,000.00 PLUSD")).toBeInTheDocument();
  });

  it("renders the Withdraw (Sell) pending amount string", () => {
    renderCard();
    // Withdraw returns USDC; only the Withdraw row (not Deposit) shows USDC
    expect(screen.getAllByText("+1,000.00 USDC")).toHaveLength(1);
    // Deposit row shows PLUSD
    expect(screen.getByText("+1,000.00 PLUSD")).toBeInTheDocument();
  });

  it("renders the Stake row amounts", () => {
    renderCard();
    expect(screen.getByText("−1,000.00 PLUSD")).toBeInTheDocument();
    expect(screen.getByText("+999.50 sPLUSD")).toBeInTheDocument();
  });

  it("renders the 'View All' button link", () => {
    renderCard();
    expect(screen.getByText(/View All/)).toBeInTheDocument();
  });

  it("'View All' button link points to /transactions", () => {
    renderCard();
    const link = screen.getByText(/View All/).closest("a");
    expect(link).toHaveAttribute("href", "/transactions");
  });

  it("does not render the empty-state caption", () => {
    renderCard();
    expect(
      screen.queryByText("You will see all transactions here"),
    ).not.toBeInTheDocument();
  });
});

describe("RecentActivityCard — connected + 6 rows (MAX_ROWS cap)", () => {
  beforeEach(() => {
    mockUseWalletView.mockReturnValue({ kind: "evm" });
    mockUseWallet.mockReturnValue({
      isConnected: true,
      address: "0x1234",
      disconnect: vi.fn(),
      openConnectModal: vi.fn(),
    });
    mockUseStellarWallet.mockReturnValue({ isConnected: false, address: undefined });
    mockUseRequests.mockReturnValue({
      data: FIXTURE_6,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders exactly 5 list items (capped at MAX_ROWS)", () => {
    renderCard();
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
  });

  it("does not render the 6th fixture amount", () => {
    renderCard();
    // 6th row is a Deposit — renders PLUSD; must not appear when MAX_ROWS=5
    expect(screen.queryByText("+4,000.00 PLUSD")).not.toBeInTheDocument();
  });
});

describe("RecentActivityCard — connected + empty list", () => {
  beforeEach(() => {
    mockUseWalletView.mockReturnValue({ kind: "evm" });
    mockUseWallet.mockReturnValue({
      isConnected: true,
      address: "0x1234",
      disconnect: vi.fn(),
      openConnectModal: vi.fn(),
    });
    mockUseStellarWallet.mockReturnValue({ isConnected: false, address: undefined });
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

  it("renders the empty-state caption", () => {
    renderCard();
    expect(
      screen.getByText("You will see all transactions here"),
    ).toBeInTheDocument();
  });

  it("does not render the 'View All' link", () => {
    renderCard();
    expect(screen.queryByText(/View All/)).not.toBeInTheDocument();
  });
});

describe("RecentActivityCard — connected + loading", () => {
  beforeEach(() => {
    mockUseWalletView.mockReturnValue({ kind: "evm" });
    mockUseWallet.mockReturnValue({
      isConnected: true,
      address: "0x1234",
      disconnect: vi.fn(),
      openConnectModal: vi.fn(),
    });
    mockUseStellarWallet.mockReturnValue({ isConnected: false, address: undefined });
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

  it("renders without throwing", () => {
    expect(() => renderCard()).not.toThrow();
  });

  it("renders the empty-state caption while loading", () => {
    renderCard();
    expect(
      screen.getByText("You will see all transactions here"),
    ).toBeInTheDocument();
  });

  it("does not render the 'View All' link while loading", () => {
    renderCard();
    expect(screen.queryByText(/View All/)).not.toBeInTheDocument();
  });
});

describe("RecentActivityCard — connected + error", () => {
  beforeEach(() => {
    mockUseWalletView.mockReturnValue({ kind: "evm" });
    mockUseWallet.mockReturnValue({
      isConnected: true,
      address: "0x1234",
      disconnect: vi.fn(),
      openConnectModal: vi.fn(),
    });
    mockUseStellarWallet.mockReturnValue({ isConnected: false, address: undefined });
    mockUseRequests.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("boom"),
      refetch: mockRefetch,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders without throwing on error", () => {
    expect(() => renderCard()).not.toThrow();
  });

  it("renders the empty-state caption on error", () => {
    renderCard();
    expect(
      screen.getByText("You will see all transactions here"),
    ).toBeInTheDocument();
  });

  it("does not render the 'View All' link on error", () => {
    renderCard();
    expect(screen.queryByText(/View All/)).not.toBeInTheDocument();
  });

  it("does not leak error text into the DOM", () => {
    renderCard();
    expect(screen.queryByText("boom")).not.toBeInTheDocument();
  });
});

// ── Active-chain gating (Issue #644) ──────────────────────────────────────────

// Stellar fixture: one Deposit row returned by useRequests for the Stellar wallet.
// Amount encoded at 7 decimals (SAC_DECIMALS): 30000000000 = 3,000 USDC.
const STELLAR_FIXTURE: RequestsResponse = {
  requests: [
    {
      type: "Deposit",
      amount: "30000000000", // 3,000 USDC at 7 decimals (SAC_DECIMALS)
      request_id: "stellar-1",
      status: "Completed",
      created_at: "2026-05-16T10:00:00Z",
    },
  ],
};

describe("RecentActivityCard — active chain gating (Issue #644)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("Stellar view + Stellar connected + data → list renders, empty-state caption absent", () => {
    // The card previously keyed off EVM isConnected. With EVM disconnected and
    // Stellar active + connected, the list should render.
    mockUseWalletView.mockReturnValue({ kind: "stellar" });
    mockUseStellarWallet.mockReturnValue({ isConnected: true, address: "GSTELLAR1" });
    mockUseWallet.mockReturnValue({ isConnected: false, address: undefined, disconnect: vi.fn(), openConnectModal: vi.fn() });
    mockUseRequests.mockReturnValue({
      data: STELLAR_FIXTURE,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    });

    renderCard();

    // List must render
    expect(screen.getByRole("list")).toBeInTheDocument();
    // Stellar fixture is a Deposit row — receives PLUSD
    expect(screen.getByText("+3,000.00 PLUSD")).toBeInTheDocument();
    // Empty-state must be absent
    expect(
      screen.queryByText("You will see all transactions here"),
    ).not.toBeInTheDocument();
  });

  it("Stellar view + Stellar disconnected → empty state renders, list absent", () => {
    mockUseWalletView.mockReturnValue({ kind: "stellar" });
    mockUseStellarWallet.mockReturnValue({ isConnected: false, address: undefined });
    mockUseWallet.mockReturnValue({ isConnected: true, address: "0xEVM", disconnect: vi.fn(), openConnectModal: vi.fn() });
    mockUseRequests.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    });

    renderCard();

    expect(
      screen.getByText("You will see all transactions here"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("EVM view + EVM connected drives the card, Stellar connection state is ignored", () => {
    mockUseWalletView.mockReturnValue({ kind: "evm" });
    mockUseWallet.mockReturnValue({ isConnected: true, address: "0xEVM", disconnect: vi.fn(), openConnectModal: vi.fn() });
    mockUseStellarWallet.mockReturnValue({ isConnected: false, address: undefined });
    mockUseRequests.mockReturnValue({
      data: FIXTURE_3,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    });

    renderCard();

    // EVM active + EVM connected + data → list
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(
      screen.queryByText("You will see all transactions here"),
    ).not.toBeInTheDocument();
  });
});

// ── Stellar decimal fix (Issue #674) ─────────────────────────────────────────

describe("RecentActivityCard — Stellar decimals (Issue #674)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // Stellar amounts at 7 dp (SAC_DECIMALS): 10_000_000 = 1.0; 9_900_000 = 0.99.
  const STELLAR_7DP: RequestsResponse = {
    requests: [
      {
        type: "Deposit",
        amount: "10000000", // 1.0 PLUSD at 7 decimals
        request_id: "s674-1",
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

  it("Stellar Deposit: 10000000 at 7 dp renders '+1.00 PLUSD', not '+10.00 PLUSD' (the bug)", () => {
    mockUseWalletView.mockReturnValue({ kind: "stellar" });
    mockUseStellarWallet.mockReturnValue({ isConnected: true, address: "GSTELLAR1" });
    mockUseWallet.mockReturnValue({ isConnected: false, address: undefined, disconnect: vi.fn(), openConnectModal: vi.fn() });
    mockUseRequests.mockReturnValue({
      data: STELLAR_7DP,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    });

    renderCard();

    expect(screen.getByText("+1.00 PLUSD")).toBeInTheDocument();
    expect(screen.queryByText("+10.00 PLUSD")).not.toBeInTheDocument();
  });

  it("Stellar Stake: 10000000/9900000 at 7 dp renders non-zero PLUSD/sPLUSD (the bug)", () => {
    mockUseWalletView.mockReturnValue({ kind: "stellar" });
    mockUseStellarWallet.mockReturnValue({ isConnected: true, address: "GSTELLAR1" });
    mockUseWallet.mockReturnValue({ isConnected: false, address: undefined, disconnect: vi.fn(), openConnectModal: vi.fn() });
    mockUseRequests.mockReturnValue({
      data: STELLAR_7DP,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    });

    renderCard();

    expect(screen.getByText("−1.00 PLUSD")).toBeInTheDocument();
    expect(screen.getByText("+0.99 sPLUSD")).toBeInTheDocument();
    // Old bug: formatted at 18 dp → effectively 0.00
    expect(screen.queryByText("−0.00 PLUSD")).not.toBeInTheDocument();
  });

  it("EVM regression: EVM Deposit at 6 dp still renders correctly after the fix", () => {
    mockUseWalletView.mockReturnValue({ kind: "evm" });
    mockUseWallet.mockReturnValue({ isConnected: true, address: "0xEVM", disconnect: vi.fn(), openConnectModal: vi.fn() });
    mockUseStellarWallet.mockReturnValue({ isConnected: false, address: undefined });
    mockUseRequests.mockReturnValue({
      data: FIXTURE_3,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    });

    renderCard();

    expect(screen.getAllByText("+1,000.00 USDC").length).toBeGreaterThanOrEqual(1);
  });

  it("EVM regression: EVM Stake at 18 dp still renders correctly after the fix", () => {
    mockUseWalletView.mockReturnValue({ kind: "evm" });
    mockUseWallet.mockReturnValue({ isConnected: true, address: "0xEVM", disconnect: vi.fn(), openConnectModal: vi.fn() });
    mockUseStellarWallet.mockReturnValue({ isConnected: false, address: undefined });
    mockUseRequests.mockReturnValue({
      data: FIXTURE_3,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    });

    renderCard();

    expect(screen.getByText("−1,000.00 PLUSD")).toBeInTheDocument();
    expect(screen.getByText("+999.50 sPLUSD")).toBeInTheDocument();
  });
});
