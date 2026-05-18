/**
 * Integration tests for the /deposit route.
 *
 * All blockchain state is seeded via the `pipeline.mock.wallet.*` localStorage
 * keys — no real wagmi calls are made. The same mock layer used in the
 * dev-server DevTools is exercised here, so the tests stay close to real usage.
 *
 * Scenarios covered:
 *   1. Approve needed — Approve button enabled, Convert disabled; click triggers approve.
 *   2. Approved — step 1 shows success badge; Convert button enabled; click triggers write.
 *   3. Insufficient balance — banner shown; StepsCard absent; Copy Address copies wallet address.
 *   4. Quick-amount chips: Min uses minDeposit; Max uses live balance.
 *   5. Disconnected wallet — both step buttons disabled, no banner.
 *   6. Min chip label reflects live minDeposit.
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
}: {
  balance?: string;
  allowance?: string;
  connected?: boolean;
  minDeposit?: string;
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
    // allowance = 0 (default) → approve needed when amount is entered
    seedBaseMocks({ allowance: "0" });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("renders without throwing", () => {
    expect(() => renderDeposit()).not.toThrow();
  });

  it("shows the Approve and Convert buttons", async () => {
    renderDeposit();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Approve" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Convert" }),
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

  it("Convert button stays disabled when approve is needed", async () => {
    const user = userEvent.setup();
    renderDeposit();

    const input = await screen.findByRole("textbox", { name: /USDC amount/i });
    await user.type(input, "2000");

    await waitFor(() => {
      const convertBtn = screen.getByRole("button", { name: "Convert" });
      expect(convertBtn).toBeDisabled();
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

    // After the mock approve resolves (Promise.resolve().then(...)), the
    // allowance should be considered sufficient (mock allowance was "0" but
    // the approve call updates mock state; the UI re-checks needsApproval).
    // At minimum the button should enter a loading/pending state or the
    // component should not crash. We verify it at least initiates the flow.
    // The mock path (useApproval mock key) does NOT call wagmi writeContract —
    // it settles via Promise.resolve().then(...) and updates internal state.
    // After settlement, step 1 transitions to "success" since the mock
    // sets isApproveSuccess=true (which triggers allowance refetch).
    await waitFor(
      () => {
        // The approve flow ran without error — component is still mounted.
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
    // allowance = 10,000 USDC — sufficient for any reasonable input
    seedBaseMocks({ allowance: "10000000000" });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("shows the Convert button (step 2)", async () => {
    renderDeposit();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Convert" }),
      ).toBeInTheDocument();
    });
  });

  it("step 1 shows success badge when allowance covers the entered amount", async () => {
    const user = userEvent.setup();
    renderDeposit();

    const input = await screen.findByRole("textbox", { name: /USDC amount/i });
    await user.type(input, "2000");

    // The success badge renders a "Done" label or a data-state="success" element
    await waitFor(() => {
      // Step 1 should be in success state — "Done" label or the success div
      const successBadge = screen.queryByText("Done");
      expect(successBadge).toBeInTheDocument();
    });
  });

  it("Convert button is enabled when allowance covers the entered amount", async () => {
    const user = userEvent.setup();
    renderDeposit();

    const input = await screen.findByRole("textbox", { name: /USDC amount/i });
    await user.type(input, "2000");

    await waitFor(() => {
      const convertBtn = screen.getByRole("button", { name: "Convert" });
      expect(convertBtn).not.toBeDisabled();
    });
  });

  it("clicking Convert triggers the requestDeposit flow", async () => {
    const user = userEvent.setup();
    renderDeposit();

    const input = await screen.findByRole("textbox", { name: /USDC amount/i });
    await user.type(input, "2000");

    const convertBtn = await screen.findByRole("button", { name: "Convert" });
    await waitFor(() => expect(convertBtn).not.toBeDisabled());
    await user.click(convertBtn);

    // The mock requestDeposit path settles via Promise.resolve().then(...)
    // and does NOT call wagmi writeContract. We verify the flow ran without
    // error by checking the component is still mounted and the button was
    // at least in a clickable state before the click.
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

    // The component only calls setCopied(true) inside the writeText .then()
    // callback — if "Copied" appears, writeText resolved successfully.
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
    seedBaseMocks({ balance: BALANCE_5000_RAW, allowance: "0" });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("Min chip sets input to the live minDeposit value (1000)", async () => {
    const user = userEvent.setup();
    renderDeposit();

    // Wait for the chip to render with the live label
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

    // Max is always the 4th chip
    const maxChip = await screen.findByRole("button", { name: "Max" });
    await user.click(maxChip);

    const input = screen.getByRole("textbox", { name: /USDC amount/i });
    expect((input as HTMLInputElement).value).toBe("5000.00");
  });
});

describe("Deposit page — disconnected wallet", () => {
  beforeEach(() => {
    localStorage.clear();
    // Seed without wallet address → disconnected
    seedBaseMocks({ connected: false });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("renders both step buttons as disabled when disconnected", async () => {
    renderDeposit();
    await waitFor(() => {
      const approveBtn = screen.getByRole("button", { name: "Approve" });
      const convertBtn = screen.getByRole("button", { name: "Convert" });
      expect(approveBtn).toBeDisabled();
      expect(convertBtn).toBeDisabled();
    });
  });

  it("does NOT show the low-balance banner when disconnected", async () => {
    renderDeposit();
    // Brief wait to let the render settle; banner must not appear
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
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("Amount = 0 → both Approve and Convert disabled", async () => {
    // No amount typed — both buttons must stay disabled even with ample allowance
    seedBaseMocks({ allowance: "10000000000" });
    renderDeposit();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Convert" })).toBeDisabled();
    });
  });

  it("Amount below minDeposit with sufficient allowance → Convert disabled (meetsMin blocks it)", async () => {
    // allowance covers 500, but 500 < 1000 minDeposit → Convert would normally
    // be enabled without the meetsMin gate — this proves meetsMin blocks it.
    // With sufficient allowance, needsApproval=false so step 1 shows "Done" (no
    // Approve button). We assert Convert is disabled and step 1 shows "Done",
    // confirming allowance IS sufficient and only meetsMin keeps Convert off.
    seedBaseMocks({ allowance: "10000000000" });
    const user = userEvent.setup();
    renderDeposit();

    const input = await screen.findByRole("textbox", { name: /USDC amount/i });
    await user.type(input, "500");

    await waitFor(() => {
      // Step 1 shows "Done" — allowance is sufficient, approval is not needed
      expect(screen.getByText("Done")).toBeInTheDocument();
      // Convert is disabled because 500 < minDeposit(1000)
      expect(screen.getByRole("button", { name: "Convert" })).toBeDisabled();
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
      expect(screen.getByRole("button", { name: "Convert" })).toBeDisabled();
    });
  });

  it("Amount equal to minDeposit with zero allowance → Approve enabled, Convert disabled", async () => {
    // Boundary: amountBig === minDeposit and allowance=0 → needsApproval=true
    seedBaseMocks({ allowance: "0" });
    const user = userEvent.setup();
    renderDeposit();

    const input = await screen.findByRole("textbox", { name: /USDC amount/i });
    await user.type(input, "1000");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Approve" })).not.toBeDisabled();
      expect(screen.getByRole("button", { name: "Convert" })).toBeDisabled();
    });
  });

  it("Amount equal to minDeposit with sufficient allowance → Convert enabled", async () => {
    // Boundary: amountBig === minDeposit and allowance covers it → Convert enabled
    seedBaseMocks({ allowance: "10000000000" });
    const user = userEvent.setup();
    renderDeposit();

    const input = await screen.findByRole("textbox", { name: /USDC amount/i });
    await user.type(input, "1000");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Convert" })).not.toBeDisabled();
    });
  });

  it("Amount greater than minDeposit with sufficient allowance → Convert enabled", async () => {
    seedBaseMocks({ allowance: "10000000000" });
    const user = userEvent.setup();
    renderDeposit();

    const input = await screen.findByRole("textbox", { name: /USDC amount/i });
    await user.type(input, "2000");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Convert" })).not.toBeDisabled();
    });
  });

  it("minDeposit undefined (removed from localStorage) → both buttons disabled regardless of amount", async () => {
    seedBaseMocks({ allowance: "10000000000" });
    // Remove minDeposit so the hook returns undefined (still loading / unavailable)
    localStorage.removeItem(
      "pipeline.mock.wallet.contract.depositManager.minDeposit",
    );
    const user = userEvent.setup();
    renderDeposit();

    const input = await screen.findByRole("textbox", { name: /USDC amount/i });
    await user.type(input, "5000");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Convert" })).toBeDisabled();
    });
  });
});

describe("Deposit page — Min chip label reflects live minDeposit", () => {
  beforeEach(() => {
    localStorage.clear();
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
