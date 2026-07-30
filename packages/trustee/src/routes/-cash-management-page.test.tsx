/**
 * Render tests for the Cash Management route (`cash-management.tsx`, issue #943).
 * Mocks the raw ramp hooks (`useRampEvents`, `useReviewRampEvent`) so the real
 * `useCashManagement` presenter + page render end-to-end; `CapitalAllocationCard`
 * is stubbed (it owns its own data layer, tested separately).
 *
 * Covers: the tab bar + switching to a placeholder tab, the shared Capital
 * Allocation slot, the inbound/outbound review sections built from mocked
 * events, the Approve and Reject-with-reason flows, and loading / error / empty.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { RampEventsResponse } from "@/api/useRampEvents";

vi.mock("@/components/CapitalAllocationCard", () => ({
  CapitalAllocationCard: () => <div data-testid="capital-allocation-stub" />,
}));
vi.mock("@/api/useRampEvents", () => ({ useRampEvents: vi.fn() }));
vi.mock("@/api/useReviewRampEvent", () => ({ useReviewRampEvent: vi.fn() }));
// The T-Bills tab's useTbillsSwap wires these directly (on-chain USDC + the
// capital-allocation tbills bucket); mock them so the page renders end-to-end.
vi.mock("@/api/useCapitalWalletBalance", () => ({
  useCapitalWalletBalance: vi.fn(),
}));
vi.mock("@/api/useCapitalAllocation", () => ({
  useCapitalAllocation: vi.fn(),
}));

import { useRampEvents } from "@/api/useRampEvents";
import { useReviewRampEvent } from "@/api/useReviewRampEvent";
import { useCapitalWalletBalance } from "@/api/useCapitalWalletBalance";
import { useCapitalAllocation } from "@/api/useCapitalAllocation";
import { Route } from "./cash-management";

const mockUseRampEvents = vi.mocked(useRampEvents);
const mockUseReviewRampEvent = vi.mocked(useReviewRampEvent);
const mockUseCapitalWalletBalance = vi.mocked(useCapitalWalletBalance);
const mockUseCapitalAllocation = vi.mocked(useCapitalAllocation);
const mockReview = vi.fn();

function renderRoute() {
  const Page = Route.options.component as React.ComponentType;
  return render(<Page />);
}

const NOW = Math.floor(Date.now() / 1000);

const EVENTS: RampEventsResponse = {
  events: [
    {
      id: 1,
      type: "OnRamp",
      to: "GAAABBBBCCCCDDDD",
      from: "GEEEFFFFGGGGHHHH",
      // 6-dec decimal string ⇒ $4,950,000.
      amount: "4950000.000000",
      created_at: NOW - 3600,
    },
    {
      id: 2,
      type: "OffRamp",
      to: "GIIIJJJJKKKKLLLL",
      from: "GMMMNNNNOOOOPPPP",
      amount: "10000000.000000",
      created_at: NOW - 7200,
    },
  ],
};

function reviewHook(overrides: Record<string, unknown> = {}) {
  return {
    review: mockReview,
    reviewAsync: vi.fn(),
    isPending: false,
    error: null as Error | null,
    reset: vi.fn(),
    pendingId: null as number | null,
    ...overrides,
  };
}

function readyEvents(data: RampEventsResponse = EVENTS) {
  mockUseRampEvents.mockReturnValue({
    data,
    isLoading: false,
    error: null,
    refetch: () => {},
  });
}

beforeEach(() => {
  mockUseRampEvents.mockReset();
  mockUseReviewRampEvent.mockReset();
  mockUseCapitalWalletBalance.mockReset();
  mockUseCapitalAllocation.mockReset();
  mockReview.mockReset();
  mockUseReviewRampEvent.mockReturnValue(reviewHook());
  // USDC balance real; tbills bucket null (hardcoded None server-side, #931).
  mockUseCapitalWalletBalance.mockReturnValue({
    data: "8400000.0000000",
    isLoading: false,
    error: null,
  });
  mockUseCapitalAllocation.mockReturnValue({
    data: {
      total: null,
      buckets: {
        capital_wallet: null,
        in_transit: null,
        trust_account: null,
        deployed: null,
        tbills: null,
      },
    },
    isLoading: false,
    error: null,
    refetch: () => {},
  });
});

describe("Cash Management route — shell", () => {
  beforeEach(() => readyEvents());

  it("renders the title, the three tabs, and the shared Capital Allocation slot", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { name: "Cash Management" }),
    ).toBeInTheDocument();
    const tabs = screen.getByTestId("cash-management-tabs");
    for (const key of ["onofframp", "tbills", "withdrawals"]) {
      expect(
        within(tabs).getByTestId(`cash-management-tab-${key}`),
      ).toBeInTheDocument();
    }
    expect(screen.getByTestId("capital-allocation-stub")).toBeInTheDocument();
  });

  it("switches to a placeholder tab (Withdrawal Queue) and hides the On/Off-ramp panel", () => {
    renderRoute();
    expect(screen.getByTestId("cash-management-onofframp")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("cash-management-tab-withdrawals"));
    expect(
      screen.getByTestId("cash-management-placeholder-withdrawals"),
    ).toHaveTextContent("#945");
    expect(
      screen.queryByTestId("cash-management-onofframp"),
    ).not.toBeInTheDocument();
  });
});

describe("Cash Management route — T-Bills swap form (#944)", () => {
  beforeEach(() => readyEvents());

  function openTbills() {
    renderRoute();
    fireEvent.click(screen.getByTestId("cash-management-tab-tbills"));
  }

  it("shows the Buy side spending real USDC, with a disabled submit and — receive/fee", () => {
    openTbills();
    const panel = screen.getByTestId("cash-management-tbills");
    // Buy is the default mode → spends USDC (the real Capital-Wallet balance).
    expect(panel).toHaveTextContent("Balance: 8,400,000 USDC");
    expect(screen.getByTestId("cash-management-tbills-submit")).toBeDisabled();
    // No USYC price served → receive + fee stay "—" (never fabricated).
    expect(
      screen.getByTestId("cash-management-tbills-receive"),
    ).toHaveTextContent("—");
  });

  it("Sell side shows the T-Bills (USYC) value as — while buckets.tbills is null, and Max is disabled", () => {
    openTbills();
    fireEvent.click(screen.getByTestId("cash-management-tbills-mode-sell"));
    const panel = screen.getByTestId("cash-management-tbills");
    expect(panel).toHaveTextContent("Balance: — USYC");
    // No sell balance → Max cannot fill anything.
    expect(screen.getByTestId("cash-management-tbills-max")).toBeDisabled();
    expect(
      screen.getByTestId("cash-management-tbills-submit"),
    ).toHaveTextContent("Sell USYC");
  });

  it("Max fills the amount from the USDC balance on the Buy side", () => {
    openTbills();
    fireEvent.click(screen.getByTestId("cash-management-tbills-max"));
    expect(screen.getByTestId("cash-management-tbills-amount")).toHaveValue(
      8400000,
    );
  });
});

describe("Cash Management route — On/Off-ramp review queue", () => {
  beforeEach(() => readyEvents());

  it("splits events into inbound (on-ramp) and outbound (off-ramp) with formatted USD amounts", () => {
    renderRoute();
    const inbound = screen.getByTestId("cash-management-inbound");
    const outbound = screen.getByTestId("cash-management-outbound");
    expect(inbound).toHaveTextContent("$4,950,000");
    expect(outbound).toHaveTextContent("$10,000,000");
    expect(screen.getAllByTestId("cash-management-ramp-event")).toHaveLength(2);
  });

  it("Approve calls review with the Approved decision (no reason)", () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("cash-management-approve-1"));
    expect(mockReview).toHaveBeenCalledWith({
      id: 1,
      decision: "Approved",
      reason: undefined,
    });
  });

  it("Reject reveals a reason field, gates confirm until filled, then calls review with the reason", () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("cash-management-reject-2"));
    const reason = screen.getByTestId("cash-management-reject-reason-2");
    const confirm = screen.getByTestId("cash-management-confirm-reject-2");
    expect(confirm).toBeDisabled();
    fireEvent.change(reason, { target: { value: "amount mismatch" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(mockReview).toHaveBeenCalledWith({
      id: 2,
      decision: "Rejected",
      reason: "amount mismatch",
    });
  });

  it("disables the row's buttons while that event is being reviewed", () => {
    mockUseReviewRampEvent.mockReturnValue(reviewHook({ pendingId: 1 }));
    renderRoute();
    expect(screen.getByTestId("cash-management-approve-1")).toBeDisabled();
    // The other row stays actionable.
    expect(screen.getByTestId("cash-management-approve-2")).toBeEnabled();
  });

  it("surfaces a review error inline", () => {
    mockUseReviewRampEvent.mockReturnValue(
      reviewHook({ error: new Error("already reviewed") }),
    );
    renderRoute();
    expect(
      screen.getByTestId("cash-management-review-error"),
    ).toHaveTextContent("already reviewed");
  });
});

describe("Cash Management route — states", () => {
  it("renders the empty state when there are no pending events", () => {
    readyEvents({ events: [] });
    renderRoute();
    expect(screen.getByTestId("cash-management-empty")).toBeInTheDocument();
  });

  it("renders a loading skeleton", () => {
    mockUseRampEvents.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: () => {},
    });
    renderRoute();
    expect(screen.getByTestId("cash-management-loading")).toBeInTheDocument();
  });

  it("renders an error state", () => {
    mockUseRampEvents.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("network error"),
      refetch: () => {},
    });
    renderRoute();
    expect(screen.getByTestId("cash-management-error")).toHaveTextContent(
      "network error",
    );
  });
});
