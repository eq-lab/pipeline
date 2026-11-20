// spec: docs/frontend/bank-transfers.md#wire-out
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthFlowContext } from "@/auth/AuthFlowContext";
import type { AuthFlowContextValue } from "@/auth/AuthFlowContext";
import { ToastProvider } from "@/lib/toast";

type Status = "Pending" | "Settled" | "Cancelled";

const h = vi.hoisted(() => {
  const write = () => ({
    request: vi.fn(),
    isPending: false,
    isSuccess: false,
    error: null as Error | null,
    wireOutId: undefined as string | undefined,
    hash: undefined,
    reset: vi.fn(),
  });
  return {
    kind: "stellar" as "stellar" | "evm",
    configured: true,
    paused: false as boolean | undefined,
    served: [] as Array<{ id: string; timestamp: string }>,
    refetch: vi.fn(),
    reads: {} as Record<string, { amountRaw?: string; status?: Status }>,
    stellar: write(),
    evm: write(),
    write,
    approval: {
      allowance: undefined,
      isSufficient: vi.fn(() => true),
      approve: vi.fn(),
      isPending: false,
      error: null,
      reset: vi.fn(),
    },
  };
});

vi.mock("@/wallet", async () => ({
  parseUnits: (await import("@/wallet/evm/units")).parseUnits,
  formatUnits: (await import("@/wallet/evm/units")).formatUnits,
  useWalletView: () => ({ kind: h.kind }),
  isWireOutMinterConfigured: () => h.configured,
  useMinterPaused: () => h.paused,
  useWireOuts: () => h.reads,
  useStellarRequestWireOut: () => h.stellar,
  useEvmRequestWireOut: () => h.evm,
  useApproval: () => h.approval,
  useDepositManagerAddresses: () => ({ plusd: "0xPLUSD" }),
}));
vi.mock("@/api", () => ({
  useWireOutRequests: () => ({
    items: h.served,
    isLoading: false,
    error: null,
    refetch: h.refetch,
  }),
}));
vi.mock("@/lib/env", () => ({
  ENV: { EVM_MINTER_ADDRESS: "0x2222222222222222222222222222222222222222" },
}));

import { BankWithdrawTab } from "./BankWithdrawTab";
import { WIRE_OUT_DESCRIPTION } from "./WireOutInfoCard";

const flow = {
  balance: 50_000_000n,
  decimals: 7,
  formattedBalance: "$5.00",
  plusdAuthorized: true as boolean | undefined,
  refetchBalance: vi.fn(),
  networkFee: "~$0.10" as string | undefined,
  isConnected: true,
};

const kybPassed = {
  lpRead: "loaded",
  kybStatus: "Passed",
} as AuthFlowContextValue;

function tree(
  kyb: Partial<AuthFlowContextValue> = kybPassed,
  flowOverride: Partial<typeof flow> = {},
) {
  const ctx = { ...kyb } as AuthFlowContextValue;
  return (
    <ToastProvider>
      <AuthFlowContext.Provider value={ctx}>
        <BankWithdrawTab
          flow={{ ...flow, ...flowOverride }}
          tabs={<div data-testid="tabs-slot" />}
          onSwap={vi.fn()}
          connectBanner={<div data-testid="connect-banner" />}
          onShowErrorDetails={vi.fn()}
        />
      </AuthFlowContext.Provider>
    </ToastProvider>
  );
}

function renderTab(
  kyb: Partial<AuthFlowContextValue> = kybPassed,
  flowOverride: Partial<typeof flow> = {},
) {
  return render(tree(kyb, flowOverride));
}

beforeEach(() => {
  vi.clearAllMocks();
  h.kind = "stellar";
  h.configured = true;
  h.paused = false;
  h.served = [];
  h.reads = {};
  h.stellar = h.write();
  h.evm = h.write();
});

describe("BankWithdrawTab layout", () => {
  it("composes the tabs slot, PLUSD input, bank output, rate and fee", () => {
    renderTab();
    expect(screen.getByTestId("tabs-slot")).toBeInTheDocument();
    expect(screen.getByTestId("wire-out-amount-input")).toBeInTheDocument();
    expect(screen.getByText("USD to your bank account")).toBeInTheDocument();
    expect(screen.getByText("1 PLUSD = 1 USD")).toBeInTheDocument();
    expect(screen.getByText("~$0.10")).toBeInTheDocument();
    expect(screen.queryByTestId("withdraw-recovery-rate")).toBeNull();
    expect(screen.queryByTestId("wire-out-list")).toBeNull();
  });

  it("mirrors the entered amount on the bank leg", async () => {
    const user = userEvent.setup();
    renderTab();
    await user.type(screen.getByTestId("wire-out-amount-input"), "2");
    expect(screen.getByTestId("conversion-output-card")).toHaveTextContent(
      "+2",
    );
  });

  it("renders the em dash for a missing network fee", () => {
    renderTab(kybPassed, { networkFee: undefined });
    expect(screen.getByTestId("conversion-details")).toHaveTextContent(
      "Network fee—",
    );
  });

  it("shows the one-line info and the verbatim docs copy behind Learn more", async () => {
    const user = userEvent.setup();
    renderTab();
    expect(screen.getByTestId("wire-out-info")).toHaveTextContent(
      "Your PLUSD stays in escrow until the Trustee sends the wire.",
    );
    expect(screen.queryByTestId("wire-out-description")).toBeNull();
    await user.click(screen.getByTestId("wire-out-learn-more"));
    expect(screen.getByTestId("wire-out-description")).toHaveTextContent(
      WIRE_OUT_DESCRIPTION,
    );
  });

  it("shows the connect banner instead of info and steps when disconnected", () => {
    renderTab(kybPassed, { isConnected: false });
    expect(screen.getByTestId("connect-banner")).toBeInTheDocument();
    expect(screen.queryByTestId("wire-out-steps-card")).toBeNull();
    expect(screen.queryByTestId("wire-out-info")).toBeNull();
  });
});

describe("BankWithdrawTab gate hints", () => {
  it("disables the action with the KYB reason without a passed KYB", () => {
    renderTab({ lpRead: "loaded", kybStatus: "UnderReview" });
    expect(screen.getByRole("button", { name: "Request" })).toBeDisabled();
    expect(
      screen.getByText("Complete KYB to withdraw to a bank account"),
    ).toBeInTheDocument();
  });

  it("disables the action for a wallet-only visitor (no auth flow context)", () => {
    render(
      <ToastProvider>
        <BankWithdrawTab
          flow={flow}
          tabs={null}
          connectBanner={null}
          onShowErrorDetails={vi.fn()}
        />
      </ToastProvider>,
    );
    expect(screen.getByRole("button", { name: "Request" })).toBeDisabled();
  });

  it("shows the paused and not-authorised reasons", () => {
    h.paused = true;
    const { unmount } = renderTab();
    expect(screen.getByText(/paused/)).toBeInTheDocument();
    unmount();
    h.paused = false;
    renderTab(kybPassed, { plusdAuthorized: false });
    expect(screen.getByText(/authorised to hold PLUSD/)).toBeInTheDocument();
  });

  it("shows the escrow hint when the gate is open", () => {
    renderTab();
    expect(
      screen.getByText(
        /moves into escrow until the Trustee settles or cancels/,
      ),
    ).toBeInTheDocument();
  });
});

describe("BankWithdrawTab list", () => {
  it("lists Pending, Settled and Cancelled rows from the contract reads", () => {
    h.served = [
      { id: "3", timestamp: "2026-10-30T10:00:00Z" },
      { id: "2", timestamp: "2026-10-29T10:00:00Z" },
      { id: "1", timestamp: "2026-10-28T10:00:00Z" },
    ];
    h.reads = {
      "3": { amountRaw: "10000000", status: "Pending" },
      "2": { amountRaw: "20000000", status: "Settled" },
      "1": { amountRaw: "30000000", status: "Cancelled" },
    };
    renderTab();
    expect(screen.getByTestId("wire-out-row-3")).toHaveTextContent(
      "−1.00 PLUSDBank transfer · Pending",
    );
    expect(screen.getByTestId("wire-out-row-2")).toHaveTextContent(
      "Bank transfer · Settled",
    );
    expect(screen.getByTestId("wire-out-row-1")).toHaveTextContent(
      "Bank transfer · Cancelled",
    );
  });

  it("shows em dashes while a read is unresolved", () => {
    h.served = [{ id: "3", timestamp: "2026-10-30T10:00:00Z" }];
    renderTab();
    expect(screen.getByTestId("wire-out-row-3")).toHaveTextContent(
      "−— PLUSDBank transfer · —",
    );
  });

  it("de-dupes the just-submitted id once the served list has it", () => {
    h.served = [{ id: "8", timestamp: "2026-10-30T10:00:00Z" }];
    renderTab();
    expect(screen.getAllByTestId("wire-out-row-8")).toHaveLength(1);
  });
});

describe("BankWithdrawTab flow", () => {
  it("shows the Stellar single step", () => {
    renderTab();
    expect(screen.getByText("Request wire-out")).toBeInTheDocument();
    expect(screen.queryByText("Allow Pipeline to use PLUSD")).toBeNull();
  });

  it("shows the approve step first on EVM", () => {
    h.kind = "evm";
    renderTab();
    expect(screen.getByText("Allow Pipeline to use PLUSD")).toBeInTheDocument();
    expect(screen.getByText("Request wire-out")).toBeInTheDocument();
  });

  it("Max fills the balance and an amount above it shows the inline error", async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(screen.getByRole("button", { name: "Max" }));
    expect(screen.getByTestId("wire-out-amount-input")).toHaveValue("5");
    await user.clear(screen.getByTestId("wire-out-amount-input"));
    await user.type(screen.getByTestId("wire-out-amount-input"), "9");
    expect(screen.getByText("Insufficient balance")).toBeInTheDocument();
  });

  it("requests the raw amount, then clears the input, shows the just-submitted row and refetches", async () => {
    const user = userEvent.setup();
    const { rerender } = renderTab();
    await user.type(screen.getByTestId("wire-out-amount-input"), "2");
    await user.click(screen.getByRole("button", { name: "Request" }));
    expect(h.stellar.request).toHaveBeenCalledWith(20_000_000n);

    h.stellar = { ...h.write(), isPending: true };
    h.reads = { "8": { amountRaw: "20000000", status: "Pending" } };
    rerender(tree());
    h.stellar = { ...h.write(), isSuccess: true, wireOutId: "8" };
    await act(async () => {
      rerender(tree());
    });

    expect(screen.getByTestId("wire-out-amount-input")).toHaveValue("");
    expect(screen.getByTestId("wire-out-row-8")).toHaveTextContent(
      "Bank transfer · Pending",
    );
    expect(h.refetch).toHaveBeenCalled();
    expect(flow.refetchBalance).toHaveBeenCalled();
    expect(
      screen.getByText("Wire-out of 2 PLUSD requested"),
    ).toBeInTheDocument();
  });
});
