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
import userEvent from "@testing-library/user-event";
import type { RampEventsResponse } from "@/api/useRampEvents";

vi.mock("@/components/CapitalAllocationCard", () => ({
  CapitalAllocationCard: () => <div data-testid="capital-allocation-stub" />,
}));
vi.mock("@/api/useRampEvents", () => ({ useRampEvents: vi.fn() }));
vi.mock("@/api/useReviewRampEvent", () => ({ useReviewRampEvent: vi.fn() }));
// The Withdrawal Queue tab's useWithdrawalQueueView reads the queue endpoint.
vi.mock("@/api/useWithdrawalQueue", () => ({ useWithdrawalQueue: vi.fn() }));
vi.mock("./-EscrowedWiresSection", () => ({
  EscrowedWiresSection: () => <div data-testid="escrow-section-stub" />,
}));
vi.mock("./-WireOutsSection", () => ({
  WireOutsSection: () => <div data-testid="wireouts-section-stub" />,
}));
vi.mock("./-ConversionsSection", () => ({
  ConversionsSection: () => <div data-testid="conversions-section-stub" />,
}));

import { useRampEvents } from "@/api/useRampEvents";
import { useReviewRampEvent } from "@/api/useReviewRampEvent";
import { useWithdrawalQueue } from "@/api/useWithdrawalQueue";
import { Route } from "./cash-management";

const mockUseRampEvents = vi.mocked(useRampEvents);
const mockUseReviewRampEvent = vi.mocked(useReviewRampEvent);
const mockUseWithdrawalQueue = vi.mocked(useWithdrawalQueue);
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
      chain_id: 99_000_001,
      type: "OnRamp",
      to: "GAAABBBBCCCCDDDD",
      from: "GEEEFFFFGGGGHHHH",
      // 6-dec decimal string ⇒ $4,950,000.
      amount: "4950000.000000",
      created_at: NOW - 3600,
    },
    {
      id: 2,
      chain_id: 99_000_001,
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
    chainId: 99_000_001,
    data,
    isLoading: false,
    error: null,
    refetch: () => {},
  });
}

beforeEach(() => {
  mockUseRampEvents.mockReset();
  mockUseReviewRampEvent.mockReset();
  mockReview.mockReset();
  mockUseReviewRampEvent.mockReturnValue(reviewHook());
  mockUseWithdrawalQueue.mockReset();
  mockUseWithdrawalQueue.mockReturnValue({
    chainId: 99_000_001,
    data: {
      summary: {
        in_queue_usd: "1200000.000000",
        requests_count: 6,
        estimated_wait_days: "3.2",
        liquid_cover: null,
      },
      items: [],
    },
    isLoading: false,
    error: null,
    refetch: () => {},
  });
});

describe("Cash Management route — shell", () => {
  beforeEach(() => readyEvents());

  it("renders the title, the four tabs, and the shared Capital Allocation slot", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { name: "Cash Management" }),
    ).toBeInTheDocument();
    const tabs = screen.getByTestId("cash-management-tabs");
    for (const key of ["onofframp", "withdrawals", "escrow", "wireouts"]) {
      expect(
        within(tabs).getByTestId(`cash-management-tab-${key}`),
      ).toBeInTheDocument();
    }
    expect(
      screen.queryByTestId("cash-management-tab-tbills"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("cash-management-swap-open"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("capital-allocation-stub")).toBeInTheDocument();
  });

  it("switches to the Withdrawal Queue tab and hides the On/Off-ramp panel", () => {
    renderRoute();
    expect(screen.getByTestId("cash-management-onofframp")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("cash-management-tab-withdrawals"));
    expect(
      screen.getByTestId("cash-management-withdrawals"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("cash-management-onofframp"),
    ).not.toBeInTheDocument();
  });
});

describe("Cash Management route — Escrowed wires tab (#1763)", () => {
  beforeEach(() => readyEvents());

  it("renders the tab and switches to the section", () => {
    renderRoute();
    const tab = screen.getByTestId("cash-management-tab-escrow");
    expect(tab).toHaveTextContent("Escrowed wires");
    expect(screen.queryByTestId("escrow-section-stub")).not.toBeInTheDocument();
    fireEvent.click(tab);
    expect(screen.getByTestId("escrow-section-stub")).toBeInTheDocument();
    expect(
      screen.queryByTestId("cash-management-onofframp"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("cash-management-tab-onofframp"));
    expect(screen.getByTestId("cash-management-onofframp")).toBeInTheDocument();
  });
});

describe("Cash Management route — Bank wire-outs tab (#1764)", () => {
  beforeEach(() => readyEvents());

  it("renders the fifth tab and switches to the section", () => {
    renderRoute();
    const tab = screen.getByTestId("cash-management-tab-wireouts");
    expect(tab).toHaveTextContent("Bank wire-outs");
    expect(
      screen.queryByTestId("wireouts-section-stub"),
    ).not.toBeInTheDocument();
    fireEvent.click(tab);
    expect(screen.getByTestId("wireouts-section-stub")).toBeInTheDocument();
    expect(
      screen.queryByTestId("cash-management-onofframp"),
    ).not.toBeInTheDocument();
  });
});

describe("Cash Management route — Withdrawal Queue tab (#945)", () => {
  beforeEach(() => readyEvents());

  it("labels the tab with the chain the trustee signed in with (#1600)", () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("cash-management-tab-withdrawals"));
    expect(
      screen.getByTestId("cash-management-withdrawals-chain"),
    ).toHaveTextContent("Stellar");
    expect(screen.getByTestId("cash-management-withdrawals")).toHaveTextContent(
      "Stellar queue — the network you signed in with",
    );
  });

  it("follows an EVM session: the chip reads Hoodi (#1600)", () => {
    mockUseWithdrawalQueue.mockReturnValue({
      chainId: 560048,
      data: {
        summary: {
          in_queue_usd: "10.000000",
          requests_count: 1,
          estimated_wait_days: null,
          liquid_cover: null,
        },
        items: [],
      },
      isLoading: false,
      error: null,
      refetch: () => {},
    });
    renderRoute();
    fireEvent.click(screen.getByTestId("cash-management-tab-withdrawals"));
    expect(
      screen.getByTestId("cash-management-withdrawals-chain"),
    ).toHaveTextContent("Hoodi");
  });

  function openWithdrawals() {
    renderRoute();
    fireEvent.click(screen.getByTestId("cash-management-tab-withdrawals"));
  }

  it("shows served total-claimable + requests, wallet balance —, and no top-up alert", () => {
    openWithdrawals();
    const panel = screen.getByTestId("cash-management-withdrawals");
    expect(
      screen.getByTestId("cash-management-withdrawals-claimable"),
    ).toHaveTextContent("$1,200,000");
    expect(panel).toHaveTextContent("Requests");
    // No served wallet balance → "—", and the top-up alert is never fabricated.
    expect(panel).toHaveTextContent("Withdrawal Queue wallet balance");
    expect(panel).toHaveTextContent("—");
    expect(
      screen.queryByTestId("cash-management-withdrawals-topup-alert"),
    ).not.toBeInTheDocument();
  });

  it("opens the top-up MPC dialog from Top up: signers static, Co-sign disabled", () => {
    openWithdrawals();
    expect(
      screen.queryByTestId("cash-management-withdrawals-dialog"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("cash-management-withdrawals-open"));
    const dialog = screen.getByTestId("cash-management-withdrawals-dialog");
    expect(dialog).toHaveAttribute("role", "dialog");
    expect(dialog).toHaveTextContent("Capital Wallet (USDC)");
    expect(dialog).toHaveTextContent("Withdrawal Queue Wallet");
    // Signature collection is a static shell; Co-sign is disabled (no MPC path).
    const signers = screen.getByTestId("cash-management-withdrawals-signers");
    expect(signers).toHaveTextContent("Trustee (you)");
    expect(signers).toHaveTextContent("Counterparty B");
    expect(
      screen.getByTestId("cash-management-withdrawals-submit"),
    ).toBeDisabled();
  });

  it("closes the dialog via Cancel", () => {
    openWithdrawals();
    fireEvent.click(screen.getByTestId("cash-management-withdrawals-open"));
    fireEvent.click(screen.getByTestId("cash-management-withdrawals-cancel"));
    expect(
      screen.queryByTestId("cash-management-withdrawals-dialog"),
    ).not.toBeInTheDocument();
  });
});

describe("Cash Management route — On/Off-ramp review queue", () => {
  beforeEach(() => readyEvents());

  it("renders the conversions section above the unchanged review queue", () => {
    renderRoute();
    expect(screen.getByTestId("conversions-section-stub")).toBeInTheDocument();
    expect(screen.getByTestId("cash-management-onofframp")).toHaveTextContent(
      "Ramp-event review",
    );
  });

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

  it("surfaces the friendly review error inline, raw text only in errorDetails (#1037)", async () => {
    const user = userEvent.setup();
    mockUseReviewRampEvent.mockReturnValue(
      reviewHook({ error: new Error("already reviewed") }),
    );
    renderRoute();
    const alert = screen.getByTestId("cash-management-review-error");
    expect(alert).toHaveTextContent("Failed to review this ramp event.");
    expect(alert).not.toHaveTextContent("already reviewed");

    await user.click(screen.getByTestId("inline-error-view-details"));
    expect(screen.getByTestId("error-details-raw")).toHaveTextContent(
      "already reviewed",
    );
  });
});

describe("Cash Management route — states", () => {
  it("renders the empty state when there are no pending events", () => {
    readyEvents({ events: [] });
    renderRoute();
    expect(screen.getByTestId("cash-management-empty")).toBeInTheDocument();
  });

  it("shows the session chain chip and scope sub-line on the ramp tab", () => {
    mockUseRampEvents.mockReturnValue({
      chainId: 560048,
      data: { events: [] },
      isLoading: false,
      error: null,
      refetch: () => {},
    });
    renderRoute();
    expect(screen.getByTestId("cash-management-ramp-chain")).toHaveTextContent(
      "Hoodi",
    );
    expect(
      screen.getByText(/Hoodi — the network you signed in with/),
    ).toBeInTheDocument();
  });

  it("renders a loading skeleton", () => {
    mockUseRampEvents.mockReturnValue({
      chainId: 99_000_001,
      data: undefined,
      isLoading: true,
      error: null,
      refetch: () => {},
    });
    renderRoute();
    expect(screen.getByTestId("cash-management-loading")).toBeInTheDocument();
  });

  it("renders the friendly error, not the raw backend text — raw only reachable via View details (#1037)", async () => {
    const user = userEvent.setup();
    mockUseRampEvents.mockReturnValue({
      chainId: 99_000_001,
      data: undefined,
      isLoading: false,
      error: new Error("network error"),
      refetch: () => {},
    });
    renderRoute();
    const alert = screen.getByTestId("cash-management-error");
    expect(alert).toHaveTextContent("Failed to load ramp events.");
    expect(alert).not.toHaveTextContent("network error");

    await user.click(screen.getByTestId("inline-error-view-details"));
    expect(screen.getByTestId("error-details-raw")).toHaveTextContent(
      "network error",
    );
  });
});
