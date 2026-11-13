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
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
  };
});
vi.mock("@/auth/sessionStore", () => ({ useSessionState: vi.fn() }));
vi.mock("@pipeline/wallet-connect", () => ({ useStellarWallet: vi.fn() }));
vi.mock("@/api/useRecordIncome", () => ({ useRecordIncome: vi.fn() }));
vi.mock("@/api/useCashReporterAccess", () => ({
  useCashReporterAccess: vi.fn(),
}));
vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return { ENV: { ...actual.ENV, STELLAR_YIELD_MINTER_ID: "CMINTER" } };
});

import { useRampEvents } from "@/api/useRampEvents";
import { useReviewRampEvent } from "@/api/useReviewRampEvent";
import { useWithdrawalQueue } from "@/api/useWithdrawalQueue";
import { useSessionState } from "@/auth/sessionStore";
import { useStellarWallet } from "@pipeline/wallet-connect";
import { useRecordIncome } from "@/api/useRecordIncome";
import { useCashReporterAccess } from "@/api/useCashReporterAccess";
import { Route } from "./cash-management";

const mockUseRampEvents = vi.mocked(useRampEvents);
const mockUseReviewRampEvent = vi.mocked(useReviewRampEvent);
const mockUseWithdrawalQueue = vi.mocked(useWithdrawalQueue);
const mockReview = vi.fn();
const mockSession = vi.mocked(useSessionState);
const mockWallet = vi.mocked(useStellarWallet);
const mockUseRecordIncome = vi.mocked(useRecordIncome);
const mockUseRole = vi.mocked(useCashReporterAccess);
const incomeAsync = vi.fn();

const routeSearch: { tab?: string } = {};
(Route as unknown as { useSearch: () => { tab?: string } }).useSearch = () =>
  routeSearch;

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

function incomeHook(overrides: Record<string, unknown> = {}) {
  mockUseRecordIncome.mockReturnValue({
    mutateAsync: incomeAsync,
    reset: vi.fn(),
    isPending: false,
    isSuccess: false,
    error: null,
    stage: null,
    ...overrides,
  } as unknown as ReturnType<typeof useRecordIncome>);
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
  delete routeSearch.tab;
  mockUseRampEvents.mockReset();
  mockUseReviewRampEvent.mockReset();
  mockReview.mockReset();
  mockUseReviewRampEvent.mockReturnValue(reviewHook());
  mockSession.mockReturnValue({
    status: "authenticated",
    address: "GTRUSTEE",
    chainId: 99_000_001,
    error: undefined,
  });
  mockWallet.mockReturnValue({
    address: "GTRUSTEE",
    isConnected: true,
    signTransaction: vi.fn(),
  } as unknown as ReturnType<typeof useStellarWallet>);
  incomeAsync.mockReset();
  incomeAsync.mockResolvedValue({ hash: "income-tx-hash" });
  incomeHook();
  mockUseRole.mockReturnValue({
    reason: null,
  } as unknown as ReturnType<typeof useCashReporterAccess>);
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
    for (const key of [
      "onofframp",
      "income",
      "withdrawals",
      "escrow",
      "wireouts",
    ]) {
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

describe("Cash Management route — Bank income tab", () => {
  beforeEach(() => readyEvents());

  async function openDialog() {
    const user = userEvent.setup();
    await user.click(screen.getByTestId("cash-management-tab-income"));
    await user.click(screen.getByTestId("cash-management-income-open"));
    return user;
  }

  async function fill(
    user: ReturnType<typeof userEvent.setup>,
    { amount = "1250.50", reference = "BANK-REF-1" } = {},
  ) {
    if (amount) {
      await user.type(
        screen.getByTestId("cash-management-income-amount"),
        amount,
      );
    }
    if (reference) {
      await user.type(
        screen.getByTestId("cash-management-income-reference"),
        reference,
      );
    }
  }

  it("renders the chain chip and an enabled Book income button", async () => {
    renderRoute();
    fireEvent.click(screen.getByTestId("cash-management-tab-income"));
    expect(
      screen.getByTestId("cash-management-income-chain"),
    ).toHaveTextContent("Stellar");
    expect(screen.getByTestId("cash-management-income-open")).toBeEnabled();
  });

  it("disables Book income with the EVM reason on an EVM session", () => {
    mockSession.mockReturnValue({
      status: "authenticated",
      address: "0xabc",
      chainId: 560048,
      error: undefined,
    });
    renderRoute();
    fireEvent.click(screen.getByTestId("cash-management-tab-income"));
    expect(screen.getByTestId("cash-management-income-open")).toBeDisabled();
    expect(
      screen.getByTestId("cash-management-income-open-reason"),
    ).toHaveTextContent(
      "Booking bank income on Hoodi is not available in the Trustee app yet.",
    );
    expect(mockUseRole).toHaveBeenCalledWith("record_income", false);
  });

  it("shows the validation messages and refuses a future value date", async () => {
    renderRoute();
    const user = await openDialog();
    await user.click(screen.getByTestId("cash-management-income-submit"));
    expect(
      screen.getByTestId("cash-management-income-validation"),
    ).toHaveTextContent(
      "Enter an amount greater than 0 with at most 2 decimal places.",
    );

    await fill(user, { reference: "" });
    await user.click(screen.getByTestId("cash-management-income-submit"));
    expect(
      screen.getByTestId("cash-management-income-validation"),
    ).toHaveTextContent("Enter the bank's reference for this income.");

    await fill(user, { amount: "", reference: "BANK-REF-1" });
    fireEvent.change(screen.getByTestId("cash-management-income-date"), {
      target: { value: "2999-01-01" },
    });
    await user.click(screen.getByTestId("cash-management-income-submit"));
    expect(
      screen.getByTestId("cash-management-income-validation"),
    ).toHaveTextContent("The value date cannot be in the future.");
    expect(incomeAsync).not.toHaveBeenCalled();
  });

  it("disables submit with the role reason for a wallet without the role", async () => {
    mockUseRole.mockReturnValue({
      reason: "Only the Cash reporter can book bank income.",
    } as unknown as ReturnType<typeof useCashReporterAccess>);
    renderRoute();
    await openDialog();
    expect(
      screen.getByTestId("cash-management-income-blocked"),
    ).toHaveTextContent("Only the Cash reporter can book bank income.");
    expect(screen.getByTestId("cash-management-income-submit")).toBeDisabled();
  });

  it("shows the reference copy when the reference is already booked", async () => {
    incomeHook({
      error: new Error(
        "RefHashSeen: this bank reference's ref_hash is already consumed",
      ),
    });
    renderRoute();
    await openDialog();
    expect(
      screen.getByTestId("cash-management-income-error"),
    ).toHaveTextContent("This bank reference is already booked on-chain.");
  });

  it("books the income, closes the dialog and shows the hash with an Audit Log link", async () => {
    renderRoute();
    const user = await openDialog();
    await fill(user);
    await user.click(screen.getByTestId("cash-management-income-submit"));
    expect(incomeAsync).toHaveBeenCalledWith({
      amount: "1250.50",
      valueDate: expect.any(Number),
      reference: "BANK-REF-1",
    });
    const success = await screen.findByTestId("cash-management-income-success");
    expect(success).toHaveTextContent("Booked $1,250.50 income");
    expect(success).toHaveTextContent("income-tx-hash");
    expect(
      within(success).getByRole("link", { name: "Audit Log" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("cash-management-income-dialog"),
    ).not.toBeInTheDocument();
  });
});

describe("Cash Management route — tab deep link (#1887)", () => {
  beforeEach(() => readyEvents());

  it("opens the Escrowed wires tab for ?tab=escrow", () => {
    routeSearch.tab = "escrow";
    renderRoute();
    expect(screen.getByTestId("escrow-section-stub")).toBeInTheDocument();
  });

  it("drops unknown tab values in validateSearch", () => {
    const validate = (
      Route.options as unknown as {
        validateSearch: (s: Record<string, unknown>) => { tab?: string };
      }
    ).validateSearch;
    expect(validate({ tab: "nope" })).toEqual({ tab: undefined });
    expect(validate({ tab: "wireouts" })).toEqual({ tab: "wireouts" });
  });
});
