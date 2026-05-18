/**
 * Integration tests for the /transactions route.
 *
 * `useRequests` is mocked to return controlled fixture data. This avoids
 * importing wagmi/AppKit and their network side effects, while still exercising
 * the full rendering and filtering logic of the Transactions page.
 *
 * The API module itself (client, useRequests) is tested separately in
 * `src/api/useRequests.test.tsx` and `src/api/client.test.ts`.
 *
 * Scenarios covered:
 *   1. Default "Buy" tab renders only Deposit rows.
 *   2. Switching tabs filters in place.
 *   3. The "All" tab is absent.
 *   4. Empty fixture renders "No activity yet" empty state.
 *   5. Error state renders "Couldn't load activity" + Retry button.
 *   6. Disconnected wallet → isLoading false, no data, no rows.
 *   7. Formatting assertions — amount strings appear in the rendered output.
 *   8. Timestamp shape assertion.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route } from "./transactions";
import type { RequestsResponse } from "@/api";

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

describe("Transactions page — default Buy tab", () => {
  beforeEach(() => {
    mockRefetch.mockClear();
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
    expect(screen.queryByText("−1,000.00 USDC")).not.toBeInTheDocument();
  });
});

describe("Transactions page — tab switching", () => {
  beforeEach(() => {
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

    expect(screen.getByText("−1,000.00 USDC")).toBeInTheDocument();
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

describe("Transactions page — empty state", () => {
  beforeEach(() => {
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

  it("renders 'No activity yet' when request list is empty", () => {
    renderTransactions();

    expect(screen.getByText("No activity yet")).toBeInTheDocument();
  });
});

describe("Transactions page — loading state", () => {
  beforeEach(() => {
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

  it("renders nothing when data is undefined (hook disabled)", () => {
    renderTransactions();

    // No rows, no error, no loading — the page just shows the empty shell
    expect(screen.queryByText("No activity yet")).not.toBeInTheDocument();
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Couldn't load activity/),
    ).not.toBeInTheDocument();
  });
});

describe("Transactions page — formatting assertions", () => {
  beforeEach(() => {
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

  it("formats Withdraw amount as '−1,000.00 USDC' on Sell tab", async () => {
    const user = userEvent.setup();
    renderTransactions();

    const sellTab = screen.getByRole("tab", { name: "Sell" });
    await user.click(sellTab);

    expect(screen.getByText("−1,000.00 USDC")).toBeInTheDocument();
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
