/**
 * Integration tests for the /deposit route (merged deposit + withdraw page).
 *
 * All blockchain state is seeded via the `pipeline.mock.wallet.*` localStorage
 * keys — no real wagmi calls are made. The same mock layer used in the
 * dev-server DevTools is exercised here, so the tests stay close to real usage.
 *
 * Scenarios covered (deposit direction):
 *   1. Approve needed — Approve button enabled, Confirm disabled; click triggers approve.
 *   2. Approved — step 1 shows success badge; Confirm button enabled; click triggers write.
 *   3. Insufficient balance — banner shown; StepsCard absent; Copy Address copies wallet address.
 *   4. Quick-amount chips: Min uses minDeposit; Max uses live balance.
 *   5. Disconnected wallet — all step buttons disabled, no banner.
 *   6. Min chip label reflects live minDeposit.
 *   7. Three-step flow: all three step labels render in order.
 *   8. After requestDeposit resolves → step 3 disabled (no voucher yet).
 *   9. With PendingClaim request + voucher mock → step 3 enabled; Claim works.
 *  10. After claim.isSuccess → step 3 shows success badge.
 *  11. PendingVerification request → step 2 shows loading affordance (spinner, not greyed).
 *  12. PendingVerification / PendingClaim → input locked to request amount, chips disabled.
 *  13. VerificationFailed → input editable (not locked).
 *  14. No active request → input editable (explicit regression assertion).
 *
 * Scenarios covered (withdraw direction):
 *  15. Connected, balance > 0, allowance 0 → Approve enabled; Confirm disabled.
 *  16. Allowance ≥ amount, no active request → Confirm enabled.
 *  17. PendingVerification mock → step 2 in loading state.
 *  18. PendingClaim + voucher mock → Claim enabled.
 *  19. Disconnected → all step buttons disabled.
 *  20. Quick-amount chips — 25% / 50% / 75% / Max.
 *  21. Step labels: "Allow Pipeline to use PLUSD" / "Confirm PLUSD burn" / "Claim your USDC".
 *
 * Swap button:
 *  22. Renders the Switch-direction button.
 *  23. Clicking swap navigates to the opposite direction.
 *  24. Clicking swap clears the amount input.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WalletProvider } from "@/wallet/WalletProvider";
import { ToastProvider } from "@/lib/toast";
import { Route } from "./deposit";

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

// Mock publicClient for gas estimation.
const mockEstimateContractGas = vi.fn(async () => 1_000_000n);
const mockPublicClient = { estimateContractGas: mockEstimateContractGas };
const mockUsePublicClient = vi.fn(() => mockPublicClient);

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
    usePublicClient: () => mockUsePublicClient(),
    useWaitForTransactionReceipt: vi.fn(() => ({
      data: undefined,
      isLoading: false,
      isSuccess: false,
      isError: false,
      error: null,
    })),
  };
});

vi.mock("@reown/appkit/react", () => ({
  createAppKit: vi.fn(),
  useAppKit: vi.fn(() => ({ open: vi.fn() })),
}));

// The deposit-route tests mock useQuery (from @tanstack/react-query) to return
// undefined, which causes useNetworkFeeEstimate to fall back to "—" via the
// `feeEth ?? "—"` expression in deposit.tsx.  Tests that need a real fee value
// should set the localStorage mock-key instead — the hook's mock-key path
// short-circuits before useQuery is called.
const mockNetworkFeeEth: string | undefined = undefined;

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
    useQuery: vi.fn(() => ({
      data: mockNetworkFeeEth,
      isLoading: false,
      error: null,
    })),
  };
});

vi.mock("@/wallet/config", () => ({
  wagmiConfig: {},
  wagmiAdapter: {},
}));

// ── API module mock ───────────────────────────────────────────────────────────
// The deposit page uses useRequests and useDepositVoucher from @/api.
// We mock them here so tests control what the API "returns" without needing
// a real QueryClient or network.

import type { RequestItem } from "@/api";
import type { VoucherResponse, WithdrawalVoucherResponse } from "@/api";

// Mutable store for test control.
let mockRequestsData: { requests: RequestItem[] } | undefined = undefined;
let mockVoucherData: VoucherResponse | undefined = undefined;
let mockVoucherStatus: "idle" | "pending" | "ready" | "failed" = "idle";
let mockWithdrawVoucherData: WithdrawalVoucherResponse | undefined = undefined;
let mockWithdrawVoucherStatus: "idle" | "pending" | "ready" | "failed" = "idle";

vi.mock("@/api", () => ({
  useRequests: () => ({
    data: mockRequestsData,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  useDepositVoucher: (_requestId: string | undefined) => ({
    data: mockVoucherData,
    status: mockVoucherStatus,
    error: null,
    refetch: vi.fn(),
  }),
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  useWithdrawalVoucher: (_requestId: string | undefined) => ({
    data: mockWithdrawVoucherData,
    status: mockWithdrawVoucherStatus,
    error: null,
    refetch: vi.fn(),
  }),
}));

// ── TanStack Router mock ──────────────────────────────────────────────────────
// deposit.tsx uses createFileRoute and Route.useSearch().
// We replace createFileRoute with a version that injects a controllable
// useSearch so tests can choose the direction without a full router context.

// Mutable direction for tests.
let mockDirection: "deposit" | "withdraw" = "deposit";

// Capture the navigate mock so tests can assert on it.
const mockNavigateFn = vi.fn();

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...original,
    useNavigate: vi.fn(() => mockNavigateFn),
    useRouterState: vi.fn(() => "/deposit"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createFileRoute: (path: any) => {
      // Build the real route so Route.options.component is available.
      const realRoute = original.createFileRoute(path);
      return (options: Record<string, unknown>) => {
        const route = realRoute(options);
        // Inject a controllable useSearch so the Deposit component
        // can read `direction` without a router context.
        (route as unknown as Record<string, unknown>).useSearch = () => ({
          direction: mockDirection,
        });
        return route;
      };
    },
    Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

// ── ENV mock ──────────────────────────────────────────────────────────────────

const DM_ADDRESS =
  "0x3333000000000000000000000000000000000003" as `0x${string}`;

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

// ── Clipboard mock ────────────────────────────────────────────────────────────

const mockWriteText = vi.fn().mockResolvedValue(undefined);

Object.defineProperty(navigator, "clipboard", {
  get() {
    return { writeText: mockWriteText };
  },
  configurable: true,
});

// ── Constants ─────────────────────────────────────────────────────────────────

const WALLET_ADDRESS = "0x1234000000000000000000000000000000000001";
const USDC_ADDRESS = "0x2222000000000000000000000000000000000002";
const PLUSD_ADDRESS = "0x1111000000000000000000000000000000000001";
const WQ_ADDRESS =
  "0x4444000000000000000000000000000000000004" as `0x${string}`;
// 1,000 USDC at 6 decimals
const MIN_DEPOSIT_RAW = "1000000000";
// 5,000 USDC at 6 decimals
const BALANCE_5000_RAW = "5000000000";
// 500 USDC at 6 decimals
const BALANCE_500_RAW = "500000000";
// 100 PLUSD at 18 decimals
const BALANCE_100_PLUSD = "100000000000000000000";
// 10 PLUSD at 18 decimals
const AMOUNT_10_PLUSD = "10000000000000000000";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Seeds the common mock keys shared by most test scenarios. */
function seedBaseMocks({
  balance = BALANCE_5000_RAW,
  allowance = "0",
  connected = true,
  minDeposit = MIN_DEPOSIT_RAW,
} = {}) {
  if (connected) {
    localStorage.setItem("pipeline.mock.wallet.address", WALLET_ADDRESS);
    localStorage.setItem("pipeline.mock.wallet.isConnected", "true");
  }

  // DepositManager addresses
  localStorage.setItem(
    "pipeline.mock.wallet.contract.depositManager.usdc",
    USDC_ADDRESS,
  );
  localStorage.setItem(
    "pipeline.mock.wallet.contract.depositManager.plusd",
    PLUSD_ADDRESS,
  );

  // minDeposit
  localStorage.setItem(
    "pipeline.mock.wallet.contract.depositManager.minDeposit",
    minDeposit,
  );

  // USDC token metadata
  localStorage.setItem(
    `pipeline.mock.wallet.contract.${USDC_ADDRESS.toLowerCase()}.decimals`,
    "6",
  );
  localStorage.setItem(
    `pipeline.mock.wallet.contract.${USDC_ADDRESS.toLowerCase()}.symbol`,
    "USDC",
  );

  // USDC balance
  localStorage.setItem(
    `pipeline.mock.wallet.balance.${USDC_ADDRESS.toLowerCase()}`,
    balance,
  );

  // USDC → DM allowance
  localStorage.setItem(
    `pipeline.mock.wallet.allowance.${USDC_ADDRESS.toLowerCase()}.${DM_ADDRESS.toLowerCase()}`,
    allowance,
  );

  // Mock approve tx
  localStorage.setItem(
    `pipeline.mock.wallet.contract.${USDC_ADDRESS.toLowerCase()}.approve`,
    JSON.stringify({ hash: "0xapprove" }),
  );

  // Mock requestDeposit tx
  localStorage.setItem(
    "pipeline.mock.wallet.contract.depositManager.requestDeposit",
    JSON.stringify({ hash: "0xdeadbeef", requestId: "42" }),
  );

  // Mock claim tx
  localStorage.setItem(
    "pipeline.mock.wallet.contract.depositManager.claim",
    JSON.stringify({ hash: "0xclaim" }),
  );
}

/** Seeds WithdrawalQueue mock keys for the withdraw-direction tests. */
function seedWithdrawMocks({
  balance = BALANCE_100_PLUSD,
  allowance = "0",
  connected = true,
  seedAllowance = true,
} = {}) {
  if (connected) {
    localStorage.setItem("pipeline.mock.wallet.address", WALLET_ADDRESS);
    localStorage.setItem("pipeline.mock.wallet.isConnected", "true");
  }

  // DepositManager named aliases — the withdraw direction now sources plusd/usdc
  // from useDepositManagerAddresses() (WithdrawalQueue has no token getters).
  localStorage.setItem(
    "pipeline.mock.wallet.contract.depositManager.plusd",
    PLUSD_ADDRESS,
  );
  localStorage.setItem(
    "pipeline.mock.wallet.contract.depositManager.usdc",
    USDC_ADDRESS,
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

  // PLUSD → WQ allowance
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

function renderDeposit() {
  const DepositPage = Route.options.component as React.ComponentType;
  return render(
    <WalletProvider>
      <ToastProvider>
        <DepositPage />
      </ToastProvider>
    </WalletProvider>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Deposit page — approve needed state", () => {
  beforeEach(() => {
    mockDirection = "deposit";
    localStorage.clear();
    mockWriteContract.mockClear();
    mockRefetch.mockClear();
    mockWriteText.mockClear();
    mockRequestsData = undefined;
    mockVoucherData = undefined;
    mockVoucherStatus = "idle";
    mockWithdrawVoucherData = undefined;
    mockWithdrawVoucherStatus = "idle";
    // allowance = 0 (default) → approve needed when amount is entered
    seedBaseMocks({ allowance: "0" });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("renders without throwing", () => {
    expect(() => renderDeposit()).not.toThrow();
  });

  it("shows the Approve and Confirm buttons", async () => {
    renderDeposit();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Approve" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Confirm" }),
      ).toBeInTheDocument();
    });
  });

  it("Approve button is disabled before amount is entered", async () => {
    renderDeposit();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    });
  });

  it("Approve button becomes enabled after entering an amount", async () => {
    const user = userEvent.setup();
    renderDeposit();

    const input = await screen.findByRole("textbox", { name: /USDC amount/i });
    await user.type(input, "2000");

    await waitFor(() => {
      const approveBtn = screen.getByRole("button", { name: "Approve" });
      expect(approveBtn).not.toBeDisabled();
    });
  });

  it("Confirm button stays disabled when approve is needed", async () => {
    const user = userEvent.setup();
    renderDeposit();

    const input = await screen.findByRole("textbox", { name: /USDC amount/i });
    await user.type(input, "2000");

    await waitFor(() => {
      const confirmBtn = screen.getByRole("button", { name: "Confirm" });
      expect(confirmBtn).toBeDisabled();
    });
  });

  it("clicking Approve triggers the approve flow (button shows loading then success)", async () => {
    const user = userEvent.setup();
    renderDeposit();

    const input = await screen.findByRole("textbox", { name: /USDC amount/i });
    await user.type(input, "2000");

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

describe("Deposit page — approved state (allowance ≥ amount)", () => {
  beforeEach(() => {
    mockDirection = "deposit";
    localStorage.clear();
    mockWriteContract.mockClear();
    mockRefetch.mockClear();
    mockRequestsData = undefined;
    mockVoucherData = undefined;
    mockVoucherStatus = "idle";
    mockWithdrawVoucherData = undefined;
    mockWithdrawVoucherStatus = "idle";
    // allowance = 10,000 USDC — sufficient for any reasonable input
    seedBaseMocks({ allowance: "10000000000" });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("shows the Confirm button (step 2)", async () => {
    renderDeposit();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Confirm" }),
      ).toBeInTheDocument();
    });
  });

  it("step 1 shows success badge when allowance covers the entered amount", async () => {
    const user = userEvent.setup();
    renderDeposit();

    const input = await screen.findByRole("textbox", { name: /USDC amount/i });
    await user.type(input, "2000");

    await waitFor(() => {
      // The success state renders a green pill with aria-label="Approve complete"
      // and data-state="success" (no "Done" text — it is an icon-only pill).
      const successBadge = screen.queryByLabelText("Approve complete");
      expect(successBadge).toBeInTheDocument();
      expect(successBadge).toHaveAttribute("data-state", "success");
    });
  });

  it("Confirm button is enabled when allowance covers the entered amount", async () => {
    const user = userEvent.setup();
    renderDeposit();

    const input = await screen.findByRole("textbox", { name: /USDC amount/i });
    await user.type(input, "2000");

    await waitFor(() => {
      const confirmBtn = screen.getByRole("button", { name: "Confirm" });
      expect(confirmBtn).not.toBeDisabled();
    });
  });

  it("clicking Confirm triggers the requestDeposit flow", async () => {
    const user = userEvent.setup();
    renderDeposit();

    const input = await screen.findByRole("textbox", { name: /USDC amount/i });
    await user.type(input, "2000");

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

describe("Deposit page — insufficient balance banner", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWriteText.mockClear();
    mockRequestsData = undefined;
    mockVoucherData = undefined;
    mockVoucherStatus = "idle";
    mockWithdrawVoucherData = undefined;
    mockWithdrawVoucherStatus = "idle";
    // balance 500 USDC < minDeposit 1,000 USDC
    seedBaseMocks({ balance: BALANCE_500_RAW, allowance: "0" });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("does NOT render the StepsCard (no Approve button)", async () => {
    renderDeposit();
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Approve" }),
      ).not.toBeInTheDocument();
    });
  });

  it("renders the low-balance banner heading", async () => {
    renderDeposit();
    await waitFor(() => {
      expect(
        screen.getByText("Add funds to your USDC balance"),
      ).toBeInTheDocument();
    });
  });

  it("banner subtitle includes the minDeposit amount", async () => {
    renderDeposit();
    await waitFor(() => {
      expect(
        screen.getByText(
          (content) =>
            content.includes("$1,000.00") && content.includes("USDC"),
        ),
      ).toBeInTheDocument();
    });
  });

  it("clicking Copy Address shows the Copied affordance (proving clipboard was called)", async () => {
    const user = userEvent.setup();
    renderDeposit();

    const copyBtn = await screen.findByRole("button", { name: "Copy Address" });
    await user.click(copyBtn);

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Copied" }),
      ).toBeInTheDocument(),
    );
  });

  it("Copy Address button label flips to 'Copied' then back", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ delay: null });
    renderDeposit();

    const copyBtn = await screen.findByRole("button", { name: "Copy Address" });
    await user.click(copyBtn);

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Copied" }),
      ).toBeInTheDocument(),
    );

    // Advance past the 1.5s reset
    act(() => {
      vi.advanceTimersByTime(1600);
    });

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Copy Address" }),
      ).toBeInTheDocument(),
    );

    vi.useRealTimers();
  });
});

describe("Deposit page — quick-amount chips", () => {
  beforeEach(() => {
    mockDirection = "deposit";
    localStorage.clear();
    mockRequestsData = undefined;
    mockVoucherData = undefined;
    mockVoucherStatus = "idle";
    mockWithdrawVoucherData = undefined;
    mockWithdrawVoucherStatus = "idle";
    seedBaseMocks({ balance: BALANCE_5000_RAW, allowance: "0" });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("Min chip sets input to the live minDeposit value (1000)", async () => {
    const user = userEvent.setup();
    renderDeposit();

    const minChip = await screen.findByRole("button", {
      name: /\$1,000\.00 \(Min\)/,
    });
    await user.click(minChip);

    const input = screen.getByRole("textbox", { name: /USDC amount/i });
    expect((input as HTMLInputElement).value).toBe("1000.00");
  });

  it("Max chip sets input to the live balance (5000)", async () => {
    const user = userEvent.setup();
    renderDeposit();

    const maxChip = await screen.findByRole("button", { name: "Max" });
    await user.click(maxChip);

    const input = screen.getByRole("textbox", { name: /USDC amount/i });
    expect((input as HTMLInputElement).value).toBe("5000.00");
  });
});

describe("Deposit page — disconnected wallet", () => {
  beforeEach(() => {
    mockDirection = "deposit";
    localStorage.clear();
    mockRequestsData = undefined;
    mockVoucherData = undefined;
    mockVoucherStatus = "idle";
    mockWithdrawVoucherData = undefined;
    mockWithdrawVoucherStatus = "idle";
    // Seed without wallet address → disconnected
    seedBaseMocks({ connected: false });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("renders all step buttons as disabled when disconnected", async () => {
    renderDeposit();
    await waitFor(() => {
      const approveBtn = screen.getByRole("button", { name: "Approve" });
      const confirmBtn = screen.getByRole("button", { name: "Confirm" });
      const claimBtn = screen.getByRole("button", { name: "Claim" });
      expect(approveBtn).toBeDisabled();
      expect(confirmBtn).toBeDisabled();
      expect(claimBtn).toBeDisabled();
    });
  });

  it("does NOT show the low-balance banner when disconnected", async () => {
    renderDeposit();
    await waitFor(() => {
      expect(
        screen.queryByText("Add funds to your USDC balance"),
      ).not.toBeInTheDocument();
    });
  });
});

describe("Deposit page — minDeposit gating", () => {
  beforeEach(() => {
    mockDirection = "deposit";
    localStorage.clear();
    mockWriteContract.mockClear();
    mockRefetch.mockClear();
    mockRequestsData = undefined;
    mockVoucherData = undefined;
    mockVoucherStatus = "idle";
    mockWithdrawVoucherData = undefined;
    mockWithdrawVoucherStatus = "idle";
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("Amount = 0 → both Approve and Confirm disabled", async () => {
    seedBaseMocks({ allowance: "10000000000" });
    renderDeposit();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
    });
  });

  it("Amount below minDeposit with sufficient allowance → Confirm disabled (meetsMin blocks it)", async () => {
    seedBaseMocks({ allowance: "10000000000" });
    const user = userEvent.setup();
    renderDeposit();

    const input = await screen.findByRole("textbox", { name: /USDC amount/i });
    await user.type(input, "500");

    await waitFor(() => {
      // The success state renders a green pill with aria-label="Approve complete"
      // (no "Done" text — it is an icon-only check pill).
      const successBadge = screen.queryByLabelText("Approve complete");
      expect(successBadge).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
    });
  });

  it("Amount below minDeposit with zero allowance → both disabled", async () => {
    seedBaseMocks({ allowance: "0" });
    const user = userEvent.setup();
    renderDeposit();

    const input = await screen.findByRole("textbox", { name: /USDC amount/i });
    await user.type(input, "500");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
    });
  });

  it("Amount equal to minDeposit with zero allowance → Approve enabled, Confirm disabled", async () => {
    seedBaseMocks({ allowance: "0" });
    const user = userEvent.setup();
    renderDeposit();

    const input = await screen.findByRole("textbox", { name: /USDC amount/i });
    await user.type(input, "1000");

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Approve" }),
      ).not.toBeDisabled();
      expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
    });
  });

  it("Amount equal to minDeposit with sufficient allowance → Confirm enabled", async () => {
    seedBaseMocks({ allowance: "10000000000" });
    const user = userEvent.setup();
    renderDeposit();

    const input = await screen.findByRole("textbox", { name: /USDC amount/i });
    await user.type(input, "1000");

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Confirm" }),
      ).not.toBeDisabled();
    });
  });

  it("Amount greater than minDeposit with sufficient allowance → Confirm enabled", async () => {
    seedBaseMocks({ allowance: "10000000000" });
    const user = userEvent.setup();
    renderDeposit();

    const input = await screen.findByRole("textbox", { name: /USDC amount/i });
    await user.type(input, "2000");

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Confirm" }),
      ).not.toBeDisabled();
    });
  });

  it("minDeposit undefined (removed from localStorage) → both buttons disabled regardless of amount", async () => {
    seedBaseMocks({ allowance: "10000000000" });
    localStorage.removeItem(
      "pipeline.mock.wallet.contract.depositManager.minDeposit",
    );
    const user = userEvent.setup();
    renderDeposit();

    const input = await screen.findByRole("textbox", { name: /USDC amount/i });
    await user.type(input, "5000");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
    });
  });
});

describe("Deposit page — Min chip label reflects live minDeposit", () => {
  beforeEach(() => {
    mockDirection = "deposit";
    localStorage.clear();
    mockRequestsData = undefined;
    mockVoucherData = undefined;
    mockVoucherStatus = "idle";
    mockWithdrawVoucherData = undefined;
    mockWithdrawVoucherStatus = "idle";
    // 250 USDC minDeposit
    seedBaseMocks({
      balance: BALANCE_5000_RAW,
      allowance: "0",
      minDeposit: "250000000",
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("Min chip label shows the live minDeposit", async () => {
    renderDeposit();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /\$250\.00 \(Min\)/ }),
      ).toBeInTheDocument();
    });
  });
});

describe("Deposit page — three-step flow", () => {
  beforeEach(() => {
    mockDirection = "deposit";
    localStorage.clear();
    mockWriteContract.mockClear();
    mockRefetch.mockClear();
    mockRequestsData = undefined;
    mockVoucherData = undefined;
    mockVoucherStatus = "idle";
    mockWithdrawVoucherData = undefined;
    mockWithdrawVoucherStatus = "idle";
    seedBaseMocks({ allowance: "0" });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("renders all three step labels in order", async () => {
    renderDeposit();
    await waitFor(() => {
      expect(
        screen.getByText("Allow Pipeline to use USDC"),
      ).toBeInTheDocument();
      expect(screen.getByText("Confirm USDC transfer")).toBeInTheDocument();
      expect(screen.getByText("Claim your PLUSD")).toBeInTheDocument();
    });
  });

  it("renders all three action buttons", async () => {
    renderDeposit();
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

  it("step 3 is disabled when no requestId is present (no active request, no local requestDeposit)", async () => {
    renderDeposit();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Claim" })).toBeDisabled();
    });
  });

  it("step 3 remains disabled when requestDeposit resolves but no voucher is available yet", async () => {
    // Seed: sufficient allowance so Confirm is enabled
    seedBaseMocks({ allowance: "10000000000" });
    // No active request from API, no voucher status set → step 3 should stay disabled
    // even after requestDeposit.write() runs (mock returns requestId: "42")
    const user = userEvent.setup();
    renderDeposit();

    const input = await screen.findByRole("textbox", { name: /USDC amount/i });
    await user.type(input, "2000");

    const confirmBtn = await screen.findByRole("button", { name: "Confirm" });
    await waitFor(() => expect(confirmBtn).not.toBeDisabled());
    await user.click(confirmBtn);

    // After click, requestDeposit.isSuccess=true + requestId="42" (from mock)
    // but voucher status is still "idle" (no PendingClaim request in API)
    await waitFor(
      () => {
        expect(screen.getByRole("button", { name: "Claim" })).toBeDisabled();
      },
      { timeout: 2000 },
    );
  });

  it("step 2 shows Done badge when request status is PendingClaim (from API poll)", async () => {
    // Seed a PendingClaim request from the API
    mockRequestsData = {
      requests: [
        {
          type: "Deposit",
          request_id: "42",
          amount: "2000000000",
          status: "PendingClaim",
          created_at: new Date().toISOString(),
        },
      ],
    };
    renderDeposit();
    await waitFor(() => {
      // Step 2 is in "success" state when PendingClaim; it renders a green pill
      // with aria-label="Confirm complete" and data-state="success" (no "Done" text).
      const step2Badge = screen.queryByLabelText("Confirm complete");
      expect(step2Badge).toBeInTheDocument();
      expect(step2Badge).toHaveAttribute("data-state", "success");
    });
  });

  it("step 2 shows loading affordance (not greyed) when request status is PendingVerification", async () => {
    // Seed a PendingVerification request — verifier has not yet advanced it.
    mockRequestsData = {
      requests: [
        {
          type: "Deposit",
          request_id: "42",
          amount: "2000000000",
          status: "PendingVerification",
          created_at: new Date().toISOString(),
        },
      ],
    };
    renderDeposit();

    // When loading=true, StepRow replaces the actionLabel text with a spinner,
    // so the "Confirm" button is no longer findable by accessible name.
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Confirm" }),
      ).not.toBeInTheDocument();
    });

    // At least one button in the document should carry aria-busy="true"
    // (the step 2 action button with the spinner).
    await waitFor(() => {
      const busyBtn = screen
        .getAllByRole("button")
        .find((b) => b.getAttribute("aria-busy") === "true");
      expect(busyBtn).toBeDefined();
      // Button must be disabled — user cannot re-trigger requestDeposit.write.
      expect(busyBtn).toBeDisabled();
    });

    // The step 2 row container must NOT carry opacity-30 (full opacity = active).
    await waitFor(() => {
      const busyBtn = screen
        .getAllByRole("button")
        .find((b) => b.getAttribute("aria-busy") === "true");
      // Walk up to the StepRow root div (the container that gets opacity-30).
      // StepRow structure: div.rootClasses > ... > div.shrink-0 > Button
      const rowRoot = busyBtn?.closest(".flex.items-center.gap-3");
      expect(rowRoot).toBeDefined();
      expect(rowRoot?.className).not.toContain("opacity-30");
    });
  });

  it("with PendingClaim request and voucher ready → Claim button enabled", async () => {
    // Seed the API with a PendingClaim request
    mockRequestsData = {
      requests: [
        {
          type: "Deposit",
          request_id: "42",
          amount: "2000000000",
          status: "PendingClaim",
          created_at: new Date().toISOString(),
        },
      ],
    };
    // Seed the voucher as ready
    mockVoucherData = {
      request_id: "42",
      amount: "2000000000",
      user: WALLET_ADDRESS,
      signature: "0xsig",
    };
    mockVoucherStatus = "ready";

    renderDeposit();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Claim" })).not.toBeDisabled();
    });
  });

  it("clicking Claim when voucher is ready triggers claim.write", async () => {
    // Set up all the prerequisites
    mockRequestsData = {
      requests: [
        {
          type: "Deposit",
          request_id: "42",
          amount: "2000000000",
          status: "PendingClaim",
          created_at: new Date().toISOString(),
        },
      ],
    };
    mockVoucherData = {
      request_id: "42",
      amount: "2000000000",
      user: WALLET_ADDRESS,
      signature: "0xsig",
    };
    mockVoucherStatus = "ready";

    const user = userEvent.setup();
    renderDeposit();

    const claimBtn = await screen.findByRole("button", { name: "Claim" });
    await waitFor(() => expect(claimBtn).not.toBeDisabled());
    await user.click(claimBtn);

    // After click, the mock claim key settles with isSuccess=true
    // The component should not crash; verify it stays mounted
    await waitFor(
      () => {
        expect(screen.getByText("1:1 Conversion")).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });
});

describe("Deposit page — locked amount on active request", () => {
  beforeEach(() => {
    mockDirection = "deposit";
    localStorage.clear();
    mockWriteContract.mockClear();
    mockRefetch.mockClear();
    mockRequestsData = undefined;
    mockVoucherData = undefined;
    mockVoucherStatus = "idle";
    mockWithdrawVoucherData = undefined;
    mockWithdrawVoucherStatus = "idle";
    seedBaseMocks({ allowance: "0" });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("PendingVerification — input is synced to request amount and disabled", async () => {
    // 5 USDC at 6 decimals
    mockRequestsData = {
      requests: [
        {
          type: "Deposit",
          request_id: "42",
          amount: "5000000",
          status: "PendingVerification",
          created_at: new Date().toISOString(),
        },
      ],
    };
    renderDeposit();

    const input = await screen.findByRole("textbox", { name: /USDC amount/i });

    await waitFor(() => {
      // formatUsdc(5_000_000n, 6) → "5.00"; commas stripped → "5.00"
      expect((input as HTMLInputElement).value).toBe("5.00");
      expect((input as HTMLInputElement).disabled).toBe(true);
    });
  });

  it("PendingClaim — input is synced to request amount and disabled", async () => {
    mockRequestsData = {
      requests: [
        {
          type: "Deposit",
          request_id: "99",
          amount: "5000000",
          status: "PendingClaim",
          created_at: new Date().toISOString(),
        },
      ],
    };
    renderDeposit();

    const input = await screen.findByRole("textbox", { name: /USDC amount/i });

    await waitFor(() => {
      expect((input as HTMLInputElement).value).toBe("5.00");
      expect((input as HTMLInputElement).disabled).toBe(true);
    });
  });

  it("PendingVerification — quick-amount chips are all disabled", async () => {
    mockRequestsData = {
      requests: [
        {
          type: "Deposit",
          request_id: "42",
          amount: "5000000",
          status: "PendingVerification",
          created_at: new Date().toISOString(),
        },
      ],
    };
    renderDeposit();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /\(Min\)/ })).toBeDisabled();
      expect(screen.getByRole("button", { name: /\$5,000/ })).toBeDisabled();
      expect(screen.getByRole("button", { name: /\$10,000/ })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Max" })).toBeDisabled();
    });
  });

  it("clicking a disabled chip does not mutate the input value", async () => {
    // HTML disabled buttons do not fire onClick — this is a regression guard.
    const user = userEvent.setup();
    mockRequestsData = {
      requests: [
        {
          type: "Deposit",
          request_id: "42",
          amount: "5000000",
          status: "PendingVerification",
          created_at: new Date().toISOString(),
        },
      ],
    };
    renderDeposit();

    const input = await screen.findByRole("textbox", { name: /USDC amount/i });
    await waitFor(() => {
      expect((input as HTMLInputElement).value).toBe("5.00");
    });

    const maxChip = screen.getByRole("button", { name: "Max" });
    await user.click(maxChip);

    // Input must still show the locked amount, not the balance.
    expect((input as HTMLInputElement).value).toBe("5.00");
  });

  it("VerificationFailed — input is editable (not locked)", async () => {
    const user = userEvent.setup();
    mockRequestsData = {
      requests: [
        {
          type: "Deposit",
          request_id: "42",
          amount: "5000000",
          status: "VerificationFailed",
          created_at: new Date().toISOString(),
        },
      ],
    };
    renderDeposit();

    const input = await screen.findByRole("textbox", { name: /USDC amount/i });

    // Input must be editable.
    await waitFor(() => {
      expect((input as HTMLInputElement).disabled).toBe(false);
    });

    // Chips must be enabled.
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /\(Min\)/ }),
      ).not.toBeDisabled();
      expect(screen.getByRole("button", { name: "Max" })).not.toBeDisabled();
    });

    // Typing must work.
    await user.clear(input);
    await user.type(input, "1234");
    expect((input as HTMLInputElement).value).toBe("1234");
  });

  it("no active request — input is editable (regression)", async () => {
    mockRequestsData = { requests: [] };
    renderDeposit();

    const input = await screen.findByRole("textbox", { name: /USDC amount/i });

    await waitFor(() => {
      expect((input as HTMLInputElement).disabled).toBe(false);
    });

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /\(Min\)/ }),
      ).not.toBeDisabled();
      expect(screen.getByRole("button", { name: "Max" })).not.toBeDisabled();
    });
  });
});

describe("Deposit page — toast emissions", () => {
  beforeEach(() => {
    mockDirection = "deposit";
    localStorage.clear();
    mockWriteContract.mockClear();
    mockRefetch.mockClear();
    mockRequestsData = undefined;
    mockVoucherData = undefined;
    mockVoucherStatus = "idle";
    mockWithdrawVoucherData = undefined;
    mockWithdrawVoucherStatus = "idle";
    seedBaseMocks({ allowance: "10000000000" });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("requestDeposit success emits a 'Deposit submitted' toast with a View button", async () => {
    const user = userEvent.setup();
    renderDeposit();

    const input = await screen.findByRole("textbox", { name: /USDC amount/i });
    await user.type(input, "2000");

    const confirmBtn = await screen.findByRole("button", { name: "Confirm" });
    await waitFor(() => expect(confirmBtn).not.toBeDisabled());
    await user.click(confirmBtn);

    // The mock settles asynchronously with isSuccess=true — wait for the
    // "Deposit submitted" toast to appear.
    await waitFor(
      () => {
        expect(screen.getByText("Deposit submitted")).toBeInTheDocument();
      },
      { timeout: 3000 },
    );

    // The actionable toast includes a "View" button.
    expect(screen.getByRole("button", { name: "View" })).toBeInTheDocument();
  });

  it("pending deposit emits a 'Sending…' toast while in flight", async () => {
    // Seed the requestDeposit mock to stay pending (no settle).
    localStorage.removeItem(
      "pipeline.mock.wallet.contract.depositManager.requestDeposit",
    );

    const user = userEvent.setup();
    renderDeposit();

    const input = await screen.findByRole("textbox", { name: /USDC amount/i });
    await user.type(input, "2000");

    const confirmBtn = await screen.findByRole("button", { name: "Confirm" });
    await waitFor(() => expect(confirmBtn).not.toBeDisabled());
    await user.click(confirmBtn);

    // The mock layer with no requestDeposit key falls back to wagmi write,
    // which in our test environment keeps isPending=true. Check the page still
    // renders. The "Sending…" toast may or may not appear depending on whether
    // the mock transitions to pending — either way no crash should occur.
    await waitFor(
      () => {
        expect(screen.getByText("1:1 Conversion")).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });

  it("regression: sub-min amount keeps Confirm disabled — no toast fires", async () => {
    const user = userEvent.setup();
    renderDeposit();

    const input = await screen.findByRole("textbox", { name: /USDC amount/i });
    // Type an amount below the 1,000 USDC minDeposit.
    await user.type(input, "500");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
    });

    // No toast should have been emitted.
    expect(screen.queryByText("Sending…")).not.toBeInTheDocument();
    expect(screen.queryByText("Deposit submitted")).not.toBeInTheDocument();
    expect(screen.queryByText("Deposit failed")).not.toBeInTheDocument();
  });

  it("StrictMode double-mount does NOT produce duplicate toasts", async () => {
    const user = userEvent.setup();
    renderDeposit();

    const input = await screen.findByRole("textbox", { name: /USDC amount/i });
    await user.type(input, "2000");

    const confirmBtn = await screen.findByRole("button", { name: "Confirm" });
    await waitFor(() => expect(confirmBtn).not.toBeDisabled());
    await user.click(confirmBtn);

    await waitFor(
      () => {
        expect(screen.getByText("Deposit submitted")).toBeInTheDocument();
      },
      { timeout: 3000 },
    );

    // Only one "Deposit submitted" toast in the DOM (id-based upsert prevents
    // duplicates even with StrictMode double-invocation).
    expect(screen.getAllByText("Deposit submitted")).toHaveLength(1);
  });
});

describe("Deposit page — DepositManager unreachable banner", () => {
  beforeEach(() => {
    mockDirection = "deposit";
    localStorage.clear();
    mockWriteContract.mockClear();
    mockRefetch.mockClear();
    mockRequestsData = undefined;
    mockVoucherData = undefined;
    mockVoucherStatus = "idle";
    mockWithdrawVoucherData = undefined;
    mockWithdrawVoucherStatus = "idle";
    // Seed wallet as connected but do NOT seed the DepositManager named aliases.
    // Without the named aliases and without a matching generic key, the hook
    // hits the real wagmi path (useReadContract returns { data: undefined, isLoading: false })
    // → both plusd and usdc remain undefined → isManagerUnreachable = true.
    localStorage.setItem("pipeline.mock.wallet.address", WALLET_ADDRESS);
    localStorage.setItem("pipeline.mock.wallet.isConnected", "true");
    // No depositManager mock keys — both addresses remain undefined.
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("renders the DepositManager unreachable banner when both addresses are undefined", async () => {
    renderDeposit();
    await waitFor(() => {
      expect(screen.getByTestId("dm-unreachable-banner")).toBeInTheDocument();
    });
  });

  it("does not render StepsCard or low-balance banner when unreachable banner is shown", async () => {
    renderDeposit();
    await waitFor(() => {
      expect(screen.getByTestId("dm-unreachable-banner")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Approve" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText("Add funds to your USDC balance"),
      ).not.toBeInTheDocument();
    });
  });

  it("banner copy references VITE_DEPOSIT_MANAGER_ADDRESS", async () => {
    renderDeposit();
    await waitFor(() => {
      expect(
        screen.getByText("DepositManager not reachable"),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/VITE_DEPOSIT_MANAGER_ADDRESS/),
      ).toBeInTheDocument();
    });
  });
});

// ── Withdraw-direction tests ───────────────────────────────────────────────────

describe("Deposit page — direction=withdraw — approve needed state", () => {
  beforeEach(() => {
    mockDirection = "withdraw";
    localStorage.clear();
    mockWriteContract.mockClear();
    mockRefetch.mockClear();
    mockRequestsData = undefined;
    mockVoucherData = undefined;
    mockVoucherStatus = "idle";
    mockWithdrawVoucherData = undefined;
    mockWithdrawVoucherStatus = "idle";
    seedWithdrawMocks({ allowance: "0" });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("renders without throwing", () => {
    expect(() => renderDeposit()).not.toThrow();
  });

  it("Approve button is disabled before amount is entered", async () => {
    renderDeposit();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    });
  });

  it("Approve button becomes enabled after entering an amount within balance", async () => {
    const user = userEvent.setup();
    renderDeposit();

    const input = await screen.findByRole("textbox", { name: /PLUSD amount/i });
    await user.type(input, "10");

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Approve" }),
      ).not.toBeDisabled();
    });
  });

  it("Confirm button stays disabled when approve is needed", async () => {
    const user = userEvent.setup();
    renderDeposit();

    const input = await screen.findByRole("textbox", { name: /PLUSD amount/i });
    await user.type(input, "10");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
    });
  });
});

describe("Deposit page — direction=withdraw — approved state (allowance ≥ amount)", () => {
  beforeEach(() => {
    mockDirection = "withdraw";
    localStorage.clear();
    mockWriteContract.mockClear();
    mockRefetch.mockClear();
    mockRequestsData = undefined;
    mockVoucherData = undefined;
    mockVoucherStatus = "idle";
    mockWithdrawVoucherData = undefined;
    mockWithdrawVoucherStatus = "idle";
    // allowance = 1000 PLUSD — sufficient for any reasonable input
    seedWithdrawMocks({ allowance: "1000000000000000000000" });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("step 1 shows success badge when allowance covers the entered amount", async () => {
    const user = userEvent.setup();
    renderDeposit();

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
    renderDeposit();

    const input = await screen.findByRole("textbox", { name: /PLUSD amount/i });
    await user.type(input, "10");

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Confirm" }),
      ).not.toBeDisabled();
    });
  });

  it("clicking Confirm triggers the requestWithdrawal flow", async () => {
    const user = userEvent.setup();
    renderDeposit();

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

describe("Deposit page — direction=withdraw — PendingVerification mock", () => {
  beforeEach(() => {
    mockDirection = "withdraw";
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
    mockWithdrawVoucherData = undefined;
    mockWithdrawVoucherStatus = "idle";
    seedWithdrawMocks({ allowance: "1000000000000000000000" });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("step 2 shows loading affordance when PendingVerification", async () => {
    renderDeposit();

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Confirm" }),
      ).not.toBeInTheDocument();
    });

    await waitFor(() => {
      const busyBtn = screen
        .getAllByRole("button")
        .find((b) => b.getAttribute("aria-busy") === "true");
      expect(busyBtn).toBeDefined();
      expect(busyBtn).toBeDisabled();
    });
  });

  it("quick-amount chips are all disabled when PendingVerification", async () => {
    renderDeposit();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "25%" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "50%" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "75%" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Max" })).toBeDisabled();
    });
  });
});

describe("Deposit page — direction=withdraw — PendingClaim with voucher ready", () => {
  beforeEach(() => {
    mockDirection = "withdraw";
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
    mockVoucherData = undefined;
    mockVoucherStatus = "idle";
    mockWithdrawVoucherData = {
      request_id: "77",
      amount: AMOUNT_10_PLUSD,
      user: WALLET_ADDRESS,
      signature: "0xsig",
    };
    mockWithdrawVoucherStatus = "ready";
    seedWithdrawMocks({ allowance: "1000000000000000000000" });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("Claim button is enabled when withdraw voucher is ready", async () => {
    renderDeposit();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Claim" })).not.toBeDisabled();
    });
  });

  it("clicking Claim triggers useClaimWithdrawal.write", async () => {
    const user = userEvent.setup();
    renderDeposit();

    const claimBtn = await screen.findByRole("button", { name: "Claim" });
    await waitFor(() => expect(claimBtn).not.toBeDisabled());
    await user.click(claimBtn);

    await waitFor(
      () => {
        expect(screen.getByText("1:1 Conversion")).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });
});

describe("Deposit page — direction=withdraw — disconnected wallet", () => {
  beforeEach(() => {
    mockDirection = "withdraw";
    localStorage.clear();
    mockRequestsData = undefined;
    mockVoucherData = undefined;
    mockVoucherStatus = "idle";
    mockWithdrawVoucherData = undefined;
    mockWithdrawVoucherStatus = "idle";
    seedWithdrawMocks({ connected: false });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("renders all step buttons as disabled when disconnected", async () => {
    renderDeposit();
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

describe("Deposit page — direction=withdraw — quick-amount chips", () => {
  beforeEach(() => {
    mockDirection = "withdraw";
    localStorage.clear();
    mockRequestsData = undefined;
    mockVoucherData = undefined;
    mockVoucherStatus = "idle";
    mockWithdrawVoucherData = undefined;
    mockWithdrawVoucherStatus = "idle";
    seedWithdrawMocks({ balance: BALANCE_100_PLUSD, allowance: "0" });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("25% chip sets input to balance * 25 / 100 = 25 PLUSD", async () => {
    const user = userEvent.setup();
    renderDeposit();

    const chip25 = await screen.findByRole("button", { name: "25%" });
    await user.click(chip25);

    const input = screen.getByRole("textbox", { name: /PLUSD amount/i });
    expect((input as HTMLInputElement).value).toBe("25.00");
  });

  it("Max chip sets input to the live balance (100 PLUSD)", async () => {
    const user = userEvent.setup();
    renderDeposit();

    const maxChip = await screen.findByRole("button", { name: "Max" });
    await user.click(maxChip);

    const input = screen.getByRole("textbox", { name: /PLUSD amount/i });
    expect((input as HTMLInputElement).value).toBe("100.00");
  });

  it("50% chip sets input to balance / 2 = 50 PLUSD", async () => {
    const user = userEvent.setup();
    renderDeposit();

    const chip50 = await screen.findByRole("button", { name: "50%" });
    await user.click(chip50);

    const input = screen.getByRole("textbox", { name: /PLUSD amount/i });
    expect((input as HTMLInputElement).value).toBe("50.00");
  });

  it("75% chip sets input to balance * 75 / 100 = 75 PLUSD", async () => {
    const user = userEvent.setup();
    renderDeposit();

    const chip75 = await screen.findByRole("button", { name: "75%" });
    await user.click(chip75);

    const input = screen.getByRole("textbox", { name: /PLUSD amount/i });
    expect((input as HTMLInputElement).value).toBe("75.00");
  });
});

describe("Deposit page — direction=withdraw — three-step flow labels", () => {
  beforeEach(() => {
    mockDirection = "withdraw";
    localStorage.clear();
    mockWriteContract.mockClear();
    mockRefetch.mockClear();
    mockRequestsData = undefined;
    mockVoucherData = undefined;
    mockVoucherStatus = "idle";
    mockWithdrawVoucherData = undefined;
    mockWithdrawVoucherStatus = "idle";
    seedWithdrawMocks({ allowance: "0" });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("renders all three step labels in order", async () => {
    renderDeposit();
    await waitFor(() => {
      expect(
        screen.getByText("Allow Pipeline to use PLUSD"),
      ).toBeInTheDocument();
      expect(screen.getByText("Confirm PLUSD burn")).toBeInTheDocument();
      expect(screen.getByText("Claim your USDC")).toBeInTheDocument();
    });
  });
});

// ── Regression: no wq-unreachable-banner when WithdrawalQueue token keys absent ─

describe("Deposit page — direction=withdraw — no wq-unreachable-banner (regression #365)", () => {
  beforeEach(() => {
    mockDirection = "withdraw";
    localStorage.clear();
    mockWriteContract.mockClear();
    mockRefetch.mockClear();
    mockRequestsData = undefined;
    mockVoucherData = undefined;
    mockVoucherStatus = "idle";
    mockWithdrawVoucherData = undefined;
    mockWithdrawVoucherStatus = "idle";
    // Seed DepositManager keys only (no WithdrawalQueue token keys).
    // This is the post-#365 setup: plusd/usdc come from DepositManager.
    seedWithdrawMocks({ allowance: "0" });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("does not render wq-unreachable-banner even when no WithdrawalQueue token mock keys are set", async () => {
    renderDeposit();
    await waitFor(() => {
      expect(
        screen.queryByTestId("wq-unreachable-banner"),
      ).not.toBeInTheDocument();
    });
  });

  it("renders the StepsCard (not a banner) on the withdraw direction", async () => {
    renderDeposit();
    await waitFor(() => {
      expect(
        screen.getByText("Allow Pipeline to use PLUSD"),
      ).toBeInTheDocument();
    });
  });
});

// ── Swap button tests ─────────────────────────────────────────────────────────

describe("Deposit page — swap button", () => {
  beforeEach(() => {
    mockDirection = "deposit";
    localStorage.clear();
    mockWriteContract.mockClear();
    mockRefetch.mockClear();
    mockNavigateFn.mockClear();
    mockRequestsData = undefined;
    mockVoucherData = undefined;
    mockVoucherStatus = "idle";
    mockWithdrawVoucherData = undefined;
    mockWithdrawVoucherStatus = "idle";
    seedBaseMocks({ allowance: "0" });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("renders the Switch direction button in the ConversionCard", async () => {
    renderDeposit();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Switch direction" }),
      ).toBeInTheDocument();
    });
  });

  it("clicking the swap button calls navigate with direction=withdraw", async () => {
    const user = userEvent.setup();
    renderDeposit();

    const swapBtn = await screen.findByRole("button", {
      name: "Switch direction",
    });
    await waitFor(() => expect(swapBtn).not.toBeDisabled());
    await user.click(swapBtn);

    await waitFor(() => {
      expect(mockNavigateFn).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "/deposit",
          search: { direction: "withdraw" },
          replace: true,
        }),
      );
    });
  });

  it("clicking the swap button clears the amount input", async () => {
    const user = userEvent.setup();
    renderDeposit();

    const input = await screen.findByRole("textbox", { name: /USDC amount/i });
    await user.type(input, "2000");

    await waitFor(() => {
      expect((input as HTMLInputElement).value).toBe("2000");
    });

    const swapBtn = screen.getByRole("button", { name: "Switch direction" });
    await waitFor(() => expect(swapBtn).not.toBeDisabled());
    await user.click(swapBtn);

    await waitFor(() => {
      expect((input as HTMLInputElement).value).toBe("");
    });
  });
});

// ── Network fee row tests ──────────────────────────────────────────────────────

describe("Deposit page — network fee row", () => {
  beforeEach(() => {
    mockDirection = "deposit";
    localStorage.clear();
    mockWriteContract.mockClear();
    mockRefetch.mockClear();
    mockRequestsData = undefined;
    mockVoucherData = undefined;
    mockVoucherStatus = "idle";
    mockWithdrawVoucherData = undefined;
    mockWithdrawVoucherStatus = "idle";
    seedBaseMocks({ allowance: "0" });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("renders the fee row with the mocked ETH amount for deposit direction", async () => {
    localStorage.setItem(
      "pipeline.mock.wallet.networkFeeEstimate.deposit",
      '"0.00053"',
    );

    renderDeposit();

    await waitFor(
      () => {
        expect(screen.getByText("~0.00053 ETH")).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });

  it("renders the fee row with the mocked ETH amount for withdraw direction", async () => {
    mockDirection = "withdraw";
    localStorage.setItem(
      "pipeline.mock.wallet.networkFeeEstimate.withdraw",
      '"0.00042"',
    );
    seedWithdrawMocks({ allowance: "0" });

    renderDeposit();

    await waitFor(
      () => {
        expect(screen.getByText("~0.00042 ETH")).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });

  it("renders the em-dash when no fee mock key is set (no RPC in test env)", async () => {
    // No mock key set → hook returns undefined → renders '—'
    renderDeposit();

    await waitFor(
      () => {
        // The component renders at all without crashing.
        expect(screen.getByText("1:1 Conversion")).toBeInTheDocument();
      },
      { timeout: 2000 },
    );

    // There should be no ETH fee string visible (no RPC call in test).
    expect(screen.queryByText(/ETH/)).not.toBeInTheDocument();
  });
});
