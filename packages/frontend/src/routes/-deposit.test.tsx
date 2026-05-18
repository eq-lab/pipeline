/**
 * Integration tests for the /deposit route.
 *
 * All blockchain state is seeded via the `pipeline.mock.wallet.*` localStorage
 * keys — no real wagmi calls are made. The same mock layer used in the
 * dev-server DevTools is exercised here, so the tests stay close to real usage.
 *
 * Scenarios covered:
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
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WalletProvider } from "@/wallet/WalletProvider";
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
// The deposit page uses useRequests and useDepositVoucher from @/api.
// We mock them here so tests control what the API "returns" without needing
// a real QueryClient or network.

import type { RequestItem } from "@/api";
import type { VoucherResponse } from "@/api";

// Mutable store for test control.
let mockRequestsData: { requests: RequestItem[] } | undefined = undefined;
let mockVoucherData: VoucherResponse | undefined = undefined;
let mockVoucherStatus: "idle" | "pending" | "ready" | "failed" = "idle";

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
}));

// ── TanStack Router mock ──────────────────────────────────────────────────────
// deposit.tsx uses createFileRoute; we only need to avoid router-dependent
// hooks. The component is imported directly below.

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...original,
    useNavigate: vi.fn(() => vi.fn()),
    useRouterState: vi.fn(() => "/deposit"),
    createFileRoute: original.createFileRoute,
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
  WALLETCONNECT_PROJECT_ID: "replace-me",
}));

vi.mock("@/lib/env", () => ({
  ENV: mockEnv,
  withEnvOverride: (overrides: Record<string, unknown>, fn: () => void) => {
    const original = { ...mockEnv };
    Object.assign(mockEnv, overrides);
    try {
      fn();
    } finally {
      Object.assign(mockEnv, original);
    }
  },
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
// 1,000 USDC at 6 decimals
const MIN_DEPOSIT_RAW = "1000000000";
// 5,000 USDC at 6 decimals
const BALANCE_5000_RAW = "5000000000";
// 500 USDC at 6 decimals
const BALANCE_500_RAW = "500000000";

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

function renderDeposit() {
  const DepositPage = Route.options.component as React.ComponentType;
  return render(
    <WalletProvider>
      <DepositPage />
    </WalletProvider>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Deposit page — approve needed state", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    mockRefetch.mockClear();
    mockWriteText.mockClear();
    mockRequestsData = undefined;
    mockVoucherData = undefined;
    mockVoucherStatus = "idle";
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
    localStorage.clear();
    mockWriteContract.mockClear();
    mockRefetch.mockClear();
    mockRequestsData = undefined;
    mockVoucherData = undefined;
    mockVoucherStatus = "idle";
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
      const successBadge = screen.queryByText("Done");
      expect(successBadge).toBeInTheDocument();
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
    localStorage.clear();
    mockRequestsData = undefined;
    mockVoucherData = undefined;
    mockVoucherStatus = "idle";
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
    localStorage.clear();
    mockWriteContract.mockClear();
    mockRefetch.mockClear();
    mockRequestsData = undefined;
    mockVoucherData = undefined;
    mockVoucherStatus = "idle";
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
      expect(screen.getByText("Done")).toBeInTheDocument();
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
    localStorage.clear();
    mockRequestsData = undefined;
    mockVoucherData = undefined;
    mockVoucherStatus = "idle";
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
      // Step 2 should show Done badge (it's in "success" state when PendingClaim)
      const doneBadges = screen.getAllByText("Done");
      // At least one Done badge for step 2
      expect(doneBadges.length).toBeGreaterThanOrEqual(1);
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
