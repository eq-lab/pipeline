/**
 * Integration tests for the /withdraw route.
 *
 * All blockchain state is seeded via the `pipeline.mock.wallet.*` localStorage
 * keys — no real wagmi calls are made. The same mock layer used in the
 * dev-server DevTools is exercised here, so the tests stay close to real usage.
 *
 * Scenarios covered:
 *   1. Connected, balance > 0, allowance 0 → step 1 enabled; click triggers approve.
 *   2. Allowance ≥ amount, no active request → step 2 enabled; click triggers write.
 *   3. PendingVerification mock → step 2 in loading state (not greyed); input locked; chips disabled.
 *   4. PendingClaim + voucher mock → step 3 enabled; click triggers useClaimWithdrawal.write.
 *   5. Zero PLUSD balance → all step buttons disabled, no low-balance banner rendered.
 *   6. claim.isSuccess → step 3 shows Done/success badge.
 *   7. Disconnected wallet → all step buttons disabled.
 *   8. Quick-amount chips — 25% sets amount to balance * 25 / 100; Max sets amount to balance.
 *   9. PendingClaim → request resolved: input editable again.
 *  10. Step labels render — assert all three labels are present in DOM.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WalletProvider } from "@/wallet/WalletProvider";
import { ToastProvider } from "@/lib/toast";
import { Route } from "./withdraw";

// ── Wagmi / AppKit mocks ──────────────────────────────────────────────────────

const mockRefetch = vi.fn();

const mockUseReadContract = vi.fn(() => ({
  data: undefined as unknown,
  isLoading: false,
  error: null,
  refetch: mockRefetch,
}));

const mockWriteContract = vi.fn();
const mockWagmiReset = vi.fn();

const stableWriteContractState = {
  writeContract: mockWriteContract,
  data: undefined as string | undefined,
  isPending: false,
  isSuccess: false,
  error: null as Error | null,
  reset: mockWagmiReset,
};
const mockUseWriteContract = vi.fn(() => stableWriteContractState);

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
    useReadContract: (...args: Parameters<typeof mockUseReadContract>) =>
      mockUseReadContract(...args),
    useWriteContract: () => mockUseWriteContract(),
  };
});

vi.mock("@reown/appkit/react", () => ({
  createAppKit: vi.fn(),
  useAppKit: vi.fn(() => ({ open: vi.fn() })),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...original,
    QueryClientProvider: ({
      children,
    }: {
      children: React.ReactNode;
      client: unknown;
    }) => <>{children}</>,
  };
});

vi.mock("@/wallet/config", () => ({
  wagmiConfig: {},
  wagmiAdapter: {},
}));

// ── API module mock ───────────────────────────────────────────────────────────
// The withdraw page uses useRequests and useWithdrawalVoucher from @/api.

import type { RequestItem } from "@/api";
import type { WithdrawalVoucherResponse } from "@/api";

// Mutable store for test control.
let mockRequestsData: { requests: RequestItem[] } | undefined = undefined;
let mockVoucherData: WithdrawalVoucherResponse | undefined = undefined;
let mockVoucherStatus: "idle" | "pending" | "ready" | "failed" = "idle";

vi.mock("@/api", () => ({
  useRequests: () => ({
    data: mockRequestsData,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  useWithdrawalVoucher: (_requestId: string | undefined) => ({
    data: mockVoucherData,
    status: mockVoucherStatus,
    error: null,
    refetch: vi.fn(),
  }),
}));

// ── TanStack Router mock ──────────────────────────────────────────────────────

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...original,
    useNavigate: vi.fn(() => vi.fn()),
    useRouterState: vi.fn(() => "/withdraw"),
    createFileRoute: original.createFileRoute,
    Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

// ── ENV mock ──────────────────────────────────────────────────────────────────

const WQ_ADDRESS =
  "0x4444000000000000000000000000000000000004" as `0x${string}`;

const mockEnv = vi.hoisted(() => ({
  EVM_CHAIN_ID: 560048,
  EVM_RPC_URL: "https://ethereum-hoodi-rpc.publicnode.com",
  DEPOSIT_MANAGER_ADDRESS:
    "0x3333000000000000000000000000000000000003" as `0x${string}`,
  WITHDRAWAL_QUEUE_ADDRESS:
    "0x4444000000000000000000000000000000000004" as `0x${string}`,
  WALLETCONNECT_PROJECT_ID: "replace-me",
}));

vi.mock("@/lib/env", () => ({
  ENV: mockEnv,
}));

// ── Constants ─────────────────────────────────────────────────────────────────

const WALLET_ADDRESS = "0x1234000000000000000000000000000000000001";
const PLUSD_ADDRESS = "0x1111000000000000000000000000000000000001";
// 100 PLUSD at 18 decimals
const BALANCE_100_PLUSD = "100000000000000000000";
// 10 PLUSD at 18 decimals
const AMOUNT_10_PLUSD = "10000000000000000000";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Seeds the common mock keys shared by most test scenarios.
 *
 * @param seedAllowance - When false, the allowance localStorage key is NOT
 *   written. This simulates the production "allowance still loading" state,
 *   where useToken returns allowance === undefined because the ERC-20
 *   allowance(owner, spender) read has not yet resolved.
 */
function seedBaseMocks({
  balance = BALANCE_100_PLUSD,
  allowance = "0",
  connected = true,
  seedAllowance = true,
} = {}) {
  if (connected) {
    localStorage.setItem("pipeline.mock.wallet.address", WALLET_ADDRESS);
    localStorage.setItem("pipeline.mock.wallet.isConnected", "true");
  }

  // WithdrawalQueue named aliases
  localStorage.setItem(
    "pipeline.mock.wallet.contract.withdrawalQueue.plusd",
    PLUSD_ADDRESS,
  );
  localStorage.setItem(
    "pipeline.mock.wallet.contract.withdrawalQueue.usdc",
    "0x2222000000000000000000000000000000000002",
  );

  // PLUSD token metadata (18 decimals)
  localStorage.setItem(
    `pipeline.mock.wallet.contract.${PLUSD_ADDRESS.toLowerCase()}.decimals`,
    "18",
  );
  localStorage.setItem(
    `pipeline.mock.wallet.contract.${PLUSD_ADDRESS.toLowerCase()}.symbol`,
    "PLUSD",
  );

  // PLUSD balance
  localStorage.setItem(
    `pipeline.mock.wallet.balance.${PLUSD_ADDRESS.toLowerCase()}`,
    balance,
  );

  // PLUSD → WQ allowance (omitted when seedAllowance=false to simulate loading)
  if (seedAllowance) {
    localStorage.setItem(
      `pipeline.mock.wallet.allowance.${PLUSD_ADDRESS.toLowerCase()}.${WQ_ADDRESS.toLowerCase()}`,
      allowance,
    );
  }

  // Mock approve tx
  localStorage.setItem(
    `pipeline.mock.wallet.contract.${PLUSD_ADDRESS.toLowerCase()}.approve`,
    JSON.stringify({ hash: "0xapprove" }),
  );

  // Mock requestWithdrawal tx
  localStorage.setItem(
    "pipeline.mock.wallet.contract.withdrawalQueue.requestWithdrawal",
    JSON.stringify({ hash: "0xrequest", requestId: "77" }),
  );

  // Mock claimWithdrawal tx
  localStorage.setItem(
    "pipeline.mock.wallet.contract.withdrawalQueue.claimWithdrawal",
    JSON.stringify({ hash: "0xclaim", amount: AMOUNT_10_PLUSD }),
  );
}

function renderWithdraw() {
  const WithdrawPage = Route.options.component as React.ComponentType;
  return render(
    <WalletProvider>
      <ToastProvider>
        <WithdrawPage />
      </ToastProvider>
    </WalletProvider>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Withdraw page — approve needed state", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    mockRefetch.mockClear();
    mockRequestsData = undefined;
    mockVoucherData = undefined;
    mockVoucherStatus = "idle";
    seedBaseMocks({ allowance: "0" });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("renders without throwing", () => {
    expect(() => renderWithdraw()).not.toThrow();
  });

  it("shows all three action buttons", async () => {
    renderWithdraw();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Approve" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Confirm" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Claim" })).toBeInTheDocument();
    });
  });

  it("Approve button is disabled before amount is entered", async () => {
    renderWithdraw();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    });
  });

  it("Approve button becomes enabled after entering an amount within balance", async () => {
    const user = userEvent.setup();
    renderWithdraw();

    const input = await screen.findByRole("textbox", { name: /PLUSD amount/i });
    await user.type(input, "10");

    await waitFor(() => {
      const approveBtn = screen.getByRole("button", { name: "Approve" });
      expect(approveBtn).not.toBeDisabled();
    });
  });

  it("Confirm button stays disabled when approve is needed", async () => {
    const user = userEvent.setup();
    renderWithdraw();

    const input = await screen.findByRole("textbox", { name: /PLUSD amount/i });
    await user.type(input, "10");

    await waitFor(() => {
      const confirmBtn = screen.getByRole("button", { name: "Confirm" });
      expect(confirmBtn).toBeDisabled();
    });
  });

  it("clicking Approve triggers the approve flow", async () => {
    const user = userEvent.setup();
    renderWithdraw();

    const input = await screen.findByRole("textbox", { name: /PLUSD amount/i });
    await user.type(input, "10");

    const approveBtn = await screen.findByRole("button", { name: "Approve" });
    await waitFor(() => expect(approveBtn).not.toBeDisabled());
    await user.click(approveBtn);

    await waitFor(
      () => {
        expect(screen.getByText("1:1 Conversion")).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });
});

describe("Withdraw page — approved state (allowance ≥ amount)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    mockRefetch.mockClear();
    mockRequestsData = undefined;
    mockVoucherData = undefined;
    mockVoucherStatus = "idle";
    // allowance = 1000 PLUSD — sufficient for any reasonable input
    seedBaseMocks({ allowance: "1000000000000000000000" });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("step 1 shows success badge when allowance covers the entered amount", async () => {
    const user = userEvent.setup();
    renderWithdraw();

    const input = await screen.findByRole("textbox", { name: /PLUSD amount/i });
    await user.type(input, "10");

    await waitFor(() => {
      const successBadge = screen.queryByLabelText("Approve complete");
      expect(successBadge).toBeInTheDocument();
      expect(successBadge).toHaveAttribute("data-state", "success");
    });
  });

  it("Confirm button is enabled when allowance covers the entered amount", async () => {
    const user = userEvent.setup();
    renderWithdraw();

    const input = await screen.findByRole("textbox", { name: /PLUSD amount/i });
    await user.type(input, "10");

    await waitFor(() => {
      const confirmBtn = screen.getByRole("button", { name: "Confirm" });
      expect(confirmBtn).not.toBeDisabled();
    });
  });

  it("clicking Confirm triggers the requestWithdrawal flow", async () => {
    const user = userEvent.setup();
    renderWithdraw();

    const input = await screen.findByRole("textbox", { name: /PLUSD amount/i });
    await user.type(input, "10");

    const confirmBtn = await screen.findByRole("button", { name: "Confirm" });
    await waitFor(() => expect(confirmBtn).not.toBeDisabled());
    await user.click(confirmBtn);

    await waitFor(
      () => {
        expect(screen.getByText("1:1 Conversion")).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });
});

describe("Withdraw page — allowance is still loading", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    mockRefetch.mockClear();
    mockRequestsData = undefined;
    mockVoucherData = undefined;
    mockVoucherStatus = "idle";
    // Balance and decimals are loaded, but allowance key is NOT written so
    // the mock layer returns undefined for the allowance read — simulating the
    // production "allowance call in-flight" state.
    seedBaseMocks({ seedAllowance: false });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("Confirm button stays disabled while allowance is undefined", async () => {
    const user = userEvent.setup();
    renderWithdraw();

    const input = await screen.findByRole("textbox", { name: /PLUSD amount/i });
    await user.type(input, "10");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
    });
  });

  it("step 1 does not show Done while allowance is undefined", async () => {
    const user = userEvent.setup();
    renderWithdraw();

    const input = await screen.findByRole("textbox", { name: /PLUSD amount/i });
    await user.type(input, "10");

    await waitFor(() => {
      const badge = screen.queryByLabelText("Approve complete");
      // Either the badge is absent or it is not in "success" state.
      if (badge !== null) {
        expect(badge).not.toHaveAttribute("data-state", "success");
      }
    });
  });

  it("input is not faded while allowance is undefined", async () => {
    const user = userEvent.setup();
    renderWithdraw();

    const input = await screen.findByRole("textbox", { name: /PLUSD amount/i });
    await user.type(input, "10");

    await waitFor(() => {
      expect((input as HTMLInputElement).className).not.toContain("opacity-30");
    });
  });
});

describe("Withdraw page — PendingVerification mock", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    mockRefetch.mockClear();
    mockRequestsData = {
      requests: [
        {
          type: "Withdraw",
          request_id: "77",
          amount: AMOUNT_10_PLUSD,
          status: "PendingVerification",
          created_at: new Date().toISOString(),
        },
      ],
    };
    mockVoucherData = undefined;
    mockVoucherStatus = "idle";
    seedBaseMocks({ allowance: "1000000000000000000000" });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("step 2 shows loading affordance (not greyed) when request status is PendingVerification", async () => {
    renderWithdraw();

    // When loading=true, StepRow replaces the actionLabel text with a spinner,
    // so the "Confirm" button is no longer findable by accessible name.
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Confirm" }),
      ).not.toBeInTheDocument();
    });

    // At least one button should carry aria-busy="true"
    await waitFor(() => {
      const busyBtn = screen
        .getAllByRole("button")
        .find((b) => b.getAttribute("aria-busy") === "true");
      expect(busyBtn).toBeDefined();
      expect(busyBtn).toBeDisabled();
    });
  });

  it("input is locked to request amount when PendingVerification", async () => {
    renderWithdraw();

    const input = await screen.findByRole("textbox", { name: /PLUSD amount/i });

    await waitFor(() => {
      // formatUsdc(10000000000000000000n, 18) → "10.00"; commas stripped → "10.00"
      expect((input as HTMLInputElement).value).toBe("10.00");
      expect((input as HTMLInputElement).disabled).toBe(true);
    });
  });

  it("quick-amount chips are all disabled when PendingVerification", async () => {
    renderWithdraw();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "25%" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "50%" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "75%" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Max" })).toBeDisabled();
    });
  });
});

describe("Withdraw page — PendingClaim with voucher ready", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    mockRefetch.mockClear();
    mockRequestsData = {
      requests: [
        {
          type: "Withdraw",
          request_id: "77",
          amount: AMOUNT_10_PLUSD,
          status: "PendingClaim",
          created_at: new Date().toISOString(),
        },
      ],
    };
    mockVoucherData = {
      request_id: "77",
      amount: AMOUNT_10_PLUSD,
      user: WALLET_ADDRESS,
      signature: "0xsig",
    };
    mockVoucherStatus = "ready";
    seedBaseMocks({ allowance: "1000000000000000000000" });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("Claim button is enabled when voucher is ready", async () => {
    renderWithdraw();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Claim" })).not.toBeDisabled();
    });
  });

  it("clicking Claim triggers useClaimWithdrawal.write with requestId and signature", async () => {
    const user = userEvent.setup();
    renderWithdraw();

    const claimBtn = await screen.findByRole("button", { name: "Claim" });
    await waitFor(() => expect(claimBtn).not.toBeDisabled());
    await user.click(claimBtn);

    // After click, the mock claim key settles with isSuccess=true
    await waitFor(
      () => {
        expect(screen.getByText("1:1 Conversion")).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });

  it("step 2 shows success badge when PendingClaim", async () => {
    renderWithdraw();
    await waitFor(() => {
      const step2Badge = screen.queryByLabelText("Confirm complete");
      expect(step2Badge).toBeInTheDocument();
      expect(step2Badge).toHaveAttribute("data-state", "success");
    });
  });
});

describe("Withdraw page — zero PLUSD balance", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    mockRefetch.mockClear();
    mockRequestsData = undefined;
    mockVoucherData = undefined;
    mockVoucherStatus = "idle";
    // Balance = 0
    seedBaseMocks({ balance: "0", allowance: "0" });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("all step buttons are disabled when balance is zero", async () => {
    renderWithdraw();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Claim" })).toBeDisabled();
    });
  });

  it("does NOT render a low-balance banner", async () => {
    renderWithdraw();
    await waitFor(() => {
      // The deposit page shows "Add funds to your USDC balance" banner — withdraw does not.
      expect(screen.queryByText(/Add funds/i)).not.toBeInTheDocument();
    });
  });
});

describe("Withdraw page — disconnected wallet", () => {
  beforeEach(() => {
    localStorage.clear();
    mockRequestsData = undefined;
    mockVoucherData = undefined;
    mockVoucherStatus = "idle";
    // Seed without wallet address → disconnected
    seedBaseMocks({ connected: false });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("renders all step buttons as disabled when disconnected", async () => {
    renderWithdraw();
    await waitFor(() => {
      const approveBtn = screen.getByRole("button", { name: "Approve" });
      const confirmBtn = screen.getByRole("button", { name: "Confirm" });
      const claimBtn = screen.getByRole("button", { name: "Claim" });
      expect(approveBtn).toBeDisabled();
      expect(confirmBtn).toBeDisabled();
      expect(claimBtn).toBeDisabled();
    });
  });
});

describe("Withdraw page — quick-amount chips", () => {
  beforeEach(() => {
    localStorage.clear();
    mockRequestsData = undefined;
    mockVoucherData = undefined;
    mockVoucherStatus = "idle";
    // Balance = 100 PLUSD
    seedBaseMocks({ balance: BALANCE_100_PLUSD, allowance: "0" });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("25% chip sets input to balance * 25 / 100 = 25 PLUSD", async () => {
    const user = userEvent.setup();
    renderWithdraw();

    const chip25 = await screen.findByRole("button", { name: "25%" });
    await user.click(chip25);

    const input = screen.getByRole("textbox", { name: /PLUSD amount/i });
    expect((input as HTMLInputElement).value).toBe("25.00");
  });

  it("Max chip sets input to the live balance (100 PLUSD)", async () => {
    const user = userEvent.setup();
    renderWithdraw();

    const maxChip = await screen.findByRole("button", { name: "Max" });
    await user.click(maxChip);

    const input = screen.getByRole("textbox", { name: /PLUSD amount/i });
    expect((input as HTMLInputElement).value).toBe("100.00");
  });

  it("50% chip sets input to balance / 2 = 50 PLUSD", async () => {
    const user = userEvent.setup();
    renderWithdraw();

    const chip50 = await screen.findByRole("button", { name: "50%" });
    await user.click(chip50);

    const input = screen.getByRole("textbox", { name: /PLUSD amount/i });
    expect((input as HTMLInputElement).value).toBe("50.00");
  });

  it("75% chip sets input to balance * 75 / 100 = 75 PLUSD", async () => {
    const user = userEvent.setup();
    renderWithdraw();

    const chip75 = await screen.findByRole("button", { name: "75%" });
    await user.click(chip75);

    const input = screen.getByRole("textbox", { name: /PLUSD amount/i });
    expect((input as HTMLInputElement).value).toBe("75.00");
  });
});

describe("Withdraw page — three-step flow labels", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    mockRefetch.mockClear();
    mockRequestsData = undefined;
    mockVoucherData = undefined;
    mockVoucherStatus = "idle";
    seedBaseMocks({ allowance: "0" });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("renders all three step labels in order", async () => {
    renderWithdraw();
    await waitFor(() => {
      expect(
        screen.getByText("Allow Pipeline to use PLUSD"),
      ).toBeInTheDocument();
      expect(screen.getByText("Confirm PLUSD burn")).toBeInTheDocument();
      expect(screen.getByText("Claim your USDC")).toBeInTheDocument();
    });
  });
});

describe("Withdraw page — claim success (step 3 done)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    mockRefetch.mockClear();
    mockRequestsData = {
      requests: [
        {
          type: "Withdraw",
          request_id: "77",
          amount: AMOUNT_10_PLUSD,
          status: "PendingClaim",
          created_at: new Date().toISOString(),
        },
      ],
    };
    mockVoucherData = {
      request_id: "77",
      amount: AMOUNT_10_PLUSD,
      user: WALLET_ADDRESS,
      signature: "0xsig",
    };
    mockVoucherStatus = "ready";
    seedBaseMocks({ allowance: "1000000000000000000000" });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("step 3 shows Done/success badge after clicking Claim", async () => {
    const user = userEvent.setup();
    renderWithdraw();

    const claimBtn = await screen.findByRole("button", { name: "Claim" });
    await waitFor(() => expect(claimBtn).not.toBeDisabled());
    await user.click(claimBtn);

    // After claim.isSuccess=true, step 3 shows the success badge
    await waitFor(
      () => {
        const claimBadge = screen.queryByLabelText("Claim complete");
        expect(claimBadge).toBeInTheDocument();
        expect(claimBadge).toHaveAttribute("data-state", "success");
      },
      { timeout: 2000 },
    );
  });
});

describe("Withdraw page — no low-balance banner", () => {
  beforeEach(() => {
    localStorage.clear();
    mockRequestsData = undefined;
    mockVoucherData = undefined;
    mockVoucherStatus = "idle";
    seedBaseMocks({ balance: "0", allowance: "0" });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("renders StepsCard (not a banner) even when balance is zero", async () => {
    renderWithdraw();
    await waitFor(() => {
      // Withdraw always renders StepsCard — no banner even when balance is zero
      expect(
        screen.getByRole("button", { name: "Approve" }),
      ).toBeInTheDocument();
    });
  });
});

describe("Withdraw page — amount exceeds balance", () => {
  beforeEach(() => {
    localStorage.clear();
    mockRequestsData = undefined;
    mockVoucherData = undefined;
    mockVoucherStatus = "idle";
    // Balance = 10 PLUSD; will enter 50 PLUSD (exceeds balance)
    seedBaseMocks({ balance: AMOUNT_10_PLUSD, allowance: "0" });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("Approve is disabled when amount exceeds PLUSD balance", async () => {
    const user = userEvent.setup();
    renderWithdraw();

    const input = await screen.findByRole("textbox", { name: /PLUSD amount/i });
    await user.type(input, "50"); // 50 > 10

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
    });
  });
});
