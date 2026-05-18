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
 *      strings; "View All →" link present and points to /transactions.
 *   3. Connected + 5 rows → exactly 3 rows render (MAX_ROWS cap).
 *   4. Connected + empty list → empty state renders; no "View All" link.
 *   5. Connected + loading → empty state renders; no "View All" link.
 *   6. Connected + error → empty state renders; no "View All" link.
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

const mockUseWallet = vi.fn(() => ({
  isConnected: false,
  address: undefined as string | undefined,
  disconnect: vi.fn(),
  openConnectModal: vi.fn(),
}));

vi.mock("@/wallet", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/wallet")>();
  return {
    ...original,
    useWallet: () => mockUseWallet(),
  };
});

// ── TanStack Router mock ──────────────────────────────────────────────────────
// Render Link as a passthrough <a href={to}> so tests can assert the href.

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...original,
    Link: ({
      children,
      to,
    }: {
      children: React.ReactNode;
      to: string;
    }) => <a href={to}>{children}</a>,
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderCard() {
  return render(<RecentActivityCard />);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("RecentActivityCard — disconnected wallet", () => {
  beforeEach(() => {
    mockUseWallet.mockReturnValue({
      isConnected: false,
      address: undefined,
      disconnect: vi.fn(),
      openConnectModal: vi.fn(),
    });
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
    mockUseWallet.mockReturnValue({
      isConnected: true,
      address: "0x1234",
      disconnect: vi.fn(),
      openConnectModal: vi.fn(),
    });
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
    expect(screen.getByText("+1,000.00 USDC")).toBeInTheDocument();
  });

  it("renders the Withdraw (Sell) pending amount string", () => {
    renderCard();
    // The pending Withdraw row renders a TwoLineAmount with the amount on the top line
    expect(screen.getByText("−1,000.00 USDC")).toBeInTheDocument();
  });

  it("renders the Stake row amounts", () => {
    renderCard();
    expect(screen.getByText("−1,000.00 PLUSD")).toBeInTheDocument();
    expect(screen.getByText("+999.50 sPLUSD")).toBeInTheDocument();
  });

  it("renders the 'View All →' link", () => {
    renderCard();
    expect(screen.getByText("View All →")).toBeInTheDocument();
  });

  it("'View All →' link points to /transactions", () => {
    renderCard();
    const link = screen.getByText("View All →").closest("a");
    expect(link).toHaveAttribute("href", "/transactions");
  });

  it("does not render the empty-state caption", () => {
    renderCard();
    expect(
      screen.queryByText("You will see all transactions here"),
    ).not.toBeInTheDocument();
  });
});

describe("RecentActivityCard — connected + 5 rows (MAX_ROWS cap)", () => {
  beforeEach(() => {
    mockUseWallet.mockReturnValue({
      isConnected: true,
      address: "0x1234",
      disconnect: vi.fn(),
      openConnectModal: vi.fn(),
    });
    mockUseRequests.mockReturnValue({
      data: FIXTURE_5,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders exactly 3 list items (capped at MAX_ROWS)", () => {
    renderCard();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("does not render the 4th or 5th fixture amounts", () => {
    renderCard();
    // 4th row is +2,000.00 USDC, 5th is −3,000.00 USDC
    expect(screen.queryByText("+2,000.00 USDC")).not.toBeInTheDocument();
    expect(screen.queryByText("−3,000.00 USDC")).not.toBeInTheDocument();
  });
});

describe("RecentActivityCard — connected + empty list", () => {
  beforeEach(() => {
    mockUseWallet.mockReturnValue({
      isConnected: true,
      address: "0x1234",
      disconnect: vi.fn(),
      openConnectModal: vi.fn(),
    });
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
    mockUseWallet.mockReturnValue({
      isConnected: true,
      address: "0x1234",
      disconnect: vi.fn(),
      openConnectModal: vi.fn(),
    });
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
    mockUseWallet.mockReturnValue({
      isConnected: true,
      address: "0x1234",
      disconnect: vi.fn(),
      openConnectModal: vi.fn(),
    });
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
