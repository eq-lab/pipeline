// spec: docs/frontend/bank-transfers.md#wire-out
import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
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

import { WireOutSection, WIRE_OUT_DESCRIPTION } from "./WireOutSection";

const flow = {
  balance: 50_000_000n,
  decimals: 7,
  formattedBalance: "$5.00",
  plusdAuthorized: true as boolean | undefined,
  refetchBalance: vi.fn(),
};

function renderSection(
  kyb: Partial<AuthFlowContextValue> = {
    lpRead: "loaded",
    kybStatus: "Passed",
  },
  props: Partial<React.ComponentProps<typeof WireOutSection>> = {},
) {
  const ctx = {
    open: vi.fn(),
    close: vi.fn(),
    openAccountSetup: vi.fn(),
    openAddEmail: vi.fn(),
    lpRead: "unknown",
    ...kyb,
  } as AuthFlowContextValue;
  return render(
    <ToastProvider>
      <AuthFlowContext.Provider value={ctx}>
        <WireOutSection
          flow={{ ...flow, ...(props.flow ?? {}) }}
          onShowErrorDetails={vi.fn()}
        />
      </AuthFlowContext.Provider>
    </ToastProvider>,
  );
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

describe("WireOutSection", () => {
  it("renders the heading, the verbatim docs copy and an enabled button", () => {
    renderSection();
    expect(screen.getByTestId("wire-out-section")).toHaveTextContent(
      "Withdraw to a bank account",
    );
    expect(screen.getByTestId("wire-out-description")).toHaveTextContent(
      WIRE_OUT_DESCRIPTION,
    );
    expect(screen.getByTestId("wire-out-open")).toBeEnabled();
    expect(screen.queryByTestId("wire-out-blocked-reason")).toBeNull();
    expect(screen.queryByTestId("wire-out-list")).toBeNull();
  });

  it("renders nothing when the minter is unconfigured", () => {
    h.configured = false;
    renderSection();
    expect(screen.queryByTestId("wire-out-section")).toBeNull();
  });

  it("disables the action with the KYB reason without a passed KYB", () => {
    renderSection({ lpRead: "loaded", kybStatus: "UnderReview" });
    expect(screen.getByTestId("wire-out-open")).toBeDisabled();
    expect(screen.getByTestId("wire-out-blocked-reason")).toHaveTextContent(
      "Complete KYB to withdraw to a bank account",
    );
  });

  it("disables the action for a wallet-only visitor (no auth flow context)", () => {
    render(
      <ToastProvider>
        <WireOutSection flow={flow} onShowErrorDetails={vi.fn()} />
      </ToastProvider>,
    );
    expect(screen.getByTestId("wire-out-open")).toBeDisabled();
  });

  it("shows the paused and not-authorised reasons", () => {
    h.paused = true;
    const { unmount } = renderSection();
    expect(screen.getByTestId("wire-out-blocked-reason")).toHaveTextContent(
      /paused/,
    );
    unmount();
    h.paused = false;
    renderSection(undefined, { flow: { ...flow, plusdAuthorized: false } });
    expect(screen.getByTestId("wire-out-blocked-reason")).toHaveTextContent(
      /authorised to hold PLUSD/,
    );
  });

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
    renderSection();
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
    renderSection();
    expect(screen.getByTestId("wire-out-row-3")).toHaveTextContent(
      "−— PLUSDBank transfer · —",
    );
  });
});

describe("WireOutModal via the section", () => {
  it("opens with the Stellar single step and the escrow hint", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByTestId("wire-out-open"));
    expect(screen.getByTestId("wire-out-modal")).toBeInTheDocument();
    expect(screen.getByText("Request wire-out")).toBeInTheDocument();
    expect(
      screen.getByText(
        /moves into escrow until the Trustee settles or cancels/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Allow Pipeline to use PLUSD")).toBeNull();
  });

  it("shows the approve step first on EVM", async () => {
    h.kind = "evm";
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByTestId("wire-out-open"));
    expect(screen.getByText("Allow Pipeline to use PLUSD")).toBeInTheDocument();
    expect(screen.getByText("Request wire-out")).toBeInTheDocument();
  });

  it("Max fills the balance and an amount above it shows the inline error", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByTestId("wire-out-open"));
    await user.click(screen.getByRole("button", { name: "Max" }));
    expect(screen.getByTestId("wire-out-amount-input")).toHaveValue("5");
    await user.clear(screen.getByTestId("wire-out-amount-input"));
    await user.type(screen.getByTestId("wire-out-amount-input"), "9");
    expect(screen.getByText("Insufficient balance")).toBeInTheDocument();
  });

  it("requests the raw amount, then closes, shows the just-submitted row and refetches", async () => {
    const user = userEvent.setup();
    const { rerender } = renderSection();
    await user.click(screen.getByTestId("wire-out-open"));
    await user.type(screen.getByTestId("wire-out-amount-input"), "2");
    await user.click(screen.getByRole("button", { name: "Request" }));
    expect(h.stellar.request).toHaveBeenCalledWith(20_000_000n);

    h.stellar = { ...h.write(), isPending: true };
    h.reads = { "8": { amountRaw: "20000000", status: "Pending" } };
    rerender(
      <ToastProvider>
        <AuthFlowContext.Provider
          value={
            {
              lpRead: "loaded",
              kybStatus: "Passed",
            } as AuthFlowContextValue
          }
        >
          <WireOutSection flow={flow} onShowErrorDetails={vi.fn()} />
        </AuthFlowContext.Provider>
      </ToastProvider>,
    );
    h.stellar = { ...h.write(), isSuccess: true, wireOutId: "8" };
    await act(async () => {
      rerender(
        <ToastProvider>
          <AuthFlowContext.Provider
            value={
              {
                lpRead: "loaded",
                kybStatus: "Passed",
              } as AuthFlowContextValue
            }
          >
            <WireOutSection flow={flow} onShowErrorDetails={vi.fn()} />
          </AuthFlowContext.Provider>
        </ToastProvider>,
      );
    });

    expect(screen.queryByTestId("wire-out-modal")).toBeNull();
    expect(screen.getByTestId("wire-out-row-8")).toHaveTextContent(
      "Bank transfer · Pending",
    );
    expect(h.refetch).toHaveBeenCalled();
    expect(flow.refetchBalance).toHaveBeenCalled();
    expect(
      screen.getByText("Wire-out of 2 PLUSD requested"),
    ).toBeInTheDocument();
  });

  it("de-dupes the just-submitted id once the served list has it", async () => {
    const user = userEvent.setup();
    h.served = [{ id: "8", timestamp: "2026-10-30T10:00:00Z" }];
    renderSection();
    expect(screen.getAllByTestId("wire-out-row-8")).toHaveLength(1);
    await user.click(screen.getByTestId("wire-out-open"));
  });
});
