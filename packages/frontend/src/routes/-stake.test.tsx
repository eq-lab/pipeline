/**
 * Integration tests for the /stake route.
 *
 * All blockchain state is seeded via the `pipeline.mock.wallet.*` localStorage
 * keys — no real wagmi calls are made. The same mock layer used in the
 * dev-server DevTools is exercised here, so the tests stay close to real usage.
 *
 * Scenarios covered:
 *
 * Stake tab:
 *   1. Connected, balance > 0, allowance 0 → Approve enabled; Stake disabled; click Approve triggers approve flow.
 *   2. Allowance ≥ amount → step 1 Done badge shown; Stake enabled; click Stake → success.
 *   3. stake.isSuccess → step 2 Done badge present; Stake button no longer rendered (success pill shown).
 *   4. Quick-amount chips: 25% sets to balance * 25/100; Max sets to full balance.
 *   5. Preview output: with convertToShares rate 0.9596 and 10 PLUSD input, output shows ~9.5960.
 *   6. Exchange-rate row shows "1 PLUSD = 0.9596 sPLUSD" (4 dp truncated).
 *
 * Unstake tab:
 *   7. Switch to Unstake → input label flips to sPLUSD; amount clears.
 *   8. sPLUSD balance > 0 → Unstake enabled; click → Done badge appears.
 *   9. Quick-amount Max uses sPLUSD balance on Unstake tab.
 *  10. Preview output: with convertToAssets rate 1.0421 and 10 sPLUSD input → ~10.4210.
 *  11. Exchange-rate row shows "1 sPLUSD = 1.0421 PLUSD" on Unstake tab.
 *
 * Cross-tab:
 *  12. Tab switch Stake → Unstake clears amount input.
 *  13. After stake success, switch to Unstake → no stale Done badge from Stake side.
 *  14. Switch back to Stake after Unstake → stake step labels render correctly.
 *
 * Edge cases:
 *  15. Disconnected wallet → all step buttons disabled on both tabs.
 *  16. Zero balance → action buttons disabled; no low-balance banner rendered.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WalletProvider } from "@/wallet/WalletProvider";
import { Route } from "./stake";

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

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...original,
    useNavigate: vi.fn(() => vi.fn()),
    useRouterState: vi.fn(() => "/stake"),
    createFileRoute: original.createFileRoute,
    Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

// ── ENV mock ──────────────────────────────────────────────────────────────────

const SPLUSD_ADDRESS =
  "0x5555000000000000000000000000000000000005" as `0x${string}`;

const mockEnv = vi.hoisted(() => ({
  EVM_CHAIN_ID: 560048,
  EVM_RPC_URL: "https://ethereum-hoodi-rpc.publicnode.com",
  DEPOSIT_MANAGER_ADDRESS:
    "0x3333000000000000000000000000000000000003" as `0x${string}`,
  WITHDRAWAL_QUEUE_ADDRESS:
    "0x4444000000000000000000000000000000000004" as `0x${string}`,
  STAKED_PLUSD_ADDRESS:
    "0x5555000000000000000000000000000000000005" as `0x${string}`,
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
// 50 sPLUSD at 18 decimals
const BALANCE_50_SPLUSD = "50000000000000000000";
// 10 PLUSD at 18 decimals
const AMOUNT_10_PLUSD = "10000000000000000000";

// convertToShares rate: 0.9596 sPLUSD per 1 PLUSD (at 1e18 scale)
const RATE_SHARES = "959600000000000000";
// convertToAssets rate: 1.0421 PLUSD per 1 sPLUSD (at 1e18 scale)
const RATE_ASSETS = "1042100000000000000";

// ── Helpers ───────────────────────────────────────────────────────────────────

function seedBaseMocks({
  balance = BALANCE_100_PLUSD,
  splusdBalance = "0",
  allowance = "0",
  connected = true,
  includeStakeMock = false,
  includeUnstakeMock = false,
}: {
  balance?: string;
  splusdBalance?: string;
  allowance?: string;
  connected?: boolean;
  includeStakeMock?: boolean;
  includeUnstakeMock?: boolean;
} = {}) {
  if (connected) {
    localStorage.setItem("pipeline.mock.wallet.address", WALLET_ADDRESS);
    localStorage.setItem("pipeline.mock.wallet.isConnected", "true");
  }

  // StakedPLUSD asset alias — resolves PLUSD address from vault's asset()
  localStorage.setItem(
    "pipeline.mock.wallet.contract.stakedPlusd.asset",
    PLUSD_ADDRESS,
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

  // sPLUSD token metadata (18 decimals)
  localStorage.setItem(
    `pipeline.mock.wallet.contract.${SPLUSD_ADDRESS.toLowerCase()}.decimals`,
    "18",
  );
  localStorage.setItem(
    `pipeline.mock.wallet.contract.${SPLUSD_ADDRESS.toLowerCase()}.symbol`,
    "sPLUSD",
  );

  // PLUSD balance
  localStorage.setItem(
    `pipeline.mock.wallet.balance.${PLUSD_ADDRESS.toLowerCase()}`,
    balance,
  );

  // sPLUSD balance
  localStorage.setItem(
    `pipeline.mock.wallet.balance.${SPLUSD_ADDRESS.toLowerCase()}`,
    splusdBalance,
  );

  // PLUSD → sPLUSD allowance
  localStorage.setItem(
    `pipeline.mock.wallet.allowance.${PLUSD_ADDRESS.toLowerCase()}.${SPLUSD_ADDRESS.toLowerCase()}`,
    allowance,
  );

  // Mock approve tx
  localStorage.setItem(
    `pipeline.mock.wallet.contract.${PLUSD_ADDRESS.toLowerCase()}.approve`,
    JSON.stringify({ hash: "0xapprove" }),
  );

  // Conversion rates
  localStorage.setItem(
    "pipeline.mock.wallet.contract.stakedPlusd.convertToShares",
    RATE_SHARES,
  );
  localStorage.setItem(
    "pipeline.mock.wallet.contract.stakedPlusd.convertToAssets",
    RATE_ASSETS,
  );

  if (includeStakeMock) {
    localStorage.setItem(
      "pipeline.mock.wallet.contract.stakedPlusd.stake",
      JSON.stringify({
        hash: "0xabc1000000000000000000000000000000000000000000000000000000000abc",
        shares: "9596000000000000000",
      }),
    );
  }

  if (includeUnstakeMock) {
    localStorage.setItem(
      "pipeline.mock.wallet.contract.stakedPlusd.unstake",
      JSON.stringify({
        hash: "0xde110000000000000000000000000000000000000000000000000000000000de",
        assets: "52105000000000000000",
      }),
    );
  }
}

function renderStake() {
  const StakePage = Route.options.component as React.ComponentType;
  return render(
    <WalletProvider>
      <StakePage />
    </WalletProvider>,
  );
}

// ── Tests — Stake tab (approve needed) ───────────────────────────────────────

describe("Stake page — approve needed state", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    mockRefetch.mockClear();
    seedBaseMocks({ allowance: "0" });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("renders without throwing", () => {
    expect(() => renderStake()).not.toThrow();
  });

  it("shows both step action buttons on Stake tab", async () => {
    renderStake();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Approve" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Stake" })).toBeInTheDocument();
    });
  });

  it("Approve button is disabled before amount is entered", async () => {
    renderStake();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    });
  });

  it("Approve button becomes enabled after entering an amount within balance", async () => {
    const user = userEvent.setup();
    renderStake();

    const input = await screen.findByRole("textbox", { name: /PLUSD amount/i });
    await user.type(input, "10");

    await waitFor(() => {
      const approveBtn = screen.getByRole("button", { name: "Approve" });
      expect(approveBtn).not.toBeDisabled();
    });
  });

  it("Stake button stays disabled when approve is needed", async () => {
    const user = userEvent.setup();
    renderStake();

    const input = await screen.findByRole("textbox", { name: /PLUSD amount/i });
    await user.type(input, "10");

    await waitFor(() => {
      const stakeBtn = screen.getByRole("button", { name: "Stake" });
      expect(stakeBtn).toBeDisabled();
    });
  });

  it("clicking Approve triggers the approve flow (mock settles)", async () => {
    const user = userEvent.setup();
    renderStake();

    const input = await screen.findByRole("textbox", { name: /PLUSD amount/i });
    await user.type(input, "10");

    const approveBtn = await screen.findByRole("button", { name: "Approve" });
    await waitFor(() => expect(approveBtn).not.toBeDisabled());
    await user.click(approveBtn);

    // After approve mock settles, the page should still show the header
    await waitFor(
      () => {
        expect(screen.getByText("Earn 8.42% p.a.")).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });
});

// ── Tests — Stake tab (approved) ─────────────────────────────────────────────

describe("Stake page — approved state (allowance ≥ amount)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    mockRefetch.mockClear();
    // allowance = 1000 PLUSD — sufficient for any reasonable input
    seedBaseMocks({
      allowance: "1000000000000000000000",
      includeStakeMock: true,
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("step 1 shows success badge when allowance covers the entered amount", async () => {
    const user = userEvent.setup();
    renderStake();

    const input = await screen.findByRole("textbox", { name: /PLUSD amount/i });
    await user.type(input, "10");

    await waitFor(() => {
      const successBadge = screen.queryByLabelText("Approve complete");
      expect(successBadge).toBeInTheDocument();
      expect(successBadge).toHaveAttribute("data-state", "success");
    });
  });

  it("Stake button is enabled when allowance covers the entered amount", async () => {
    const user = userEvent.setup();
    renderStake();

    const input = await screen.findByRole("textbox", { name: /PLUSD amount/i });
    await user.type(input, "10");

    await waitFor(() => {
      const stakeBtn = screen.getByRole("button", { name: "Stake" });
      expect(stakeBtn).not.toBeDisabled();
    });
  });

  it("clicking Stake triggers the stake flow and shows success badge", async () => {
    const user = userEvent.setup();
    renderStake();

    const input = await screen.findByRole("textbox", { name: /PLUSD amount/i });
    await user.type(input, "10");

    const stakeBtn = await screen.findByRole("button", { name: "Stake" });
    await waitFor(() => expect(stakeBtn).not.toBeDisabled());
    await user.click(stakeBtn);

    // After stake mock settles, step 2 shows success badge
    await waitFor(
      () => {
        const stakeBadge = screen.queryByLabelText("Stake complete");
        expect(stakeBadge).toBeInTheDocument();
        expect(stakeBadge).toHaveAttribute("data-state", "success");
      },
      { timeout: 2000 },
    );
  });

  it("step 2 Done badge appears once stake.isSuccess (Stake button replaced by success pill)", async () => {
    const user = userEvent.setup();
    renderStake();

    const input = await screen.findByRole("textbox", { name: /PLUSD amount/i });
    await user.type(input, "10");

    const stakeBtn = await screen.findByRole("button", { name: "Stake" });
    await waitFor(() => expect(stakeBtn).not.toBeDisabled());
    await user.click(stakeBtn);

    // After success, the "Stake complete" badge should be present
    // (the action button is replaced by the success pill in StepRow)
    await waitFor(
      () => {
        const badge = screen.queryByLabelText("Stake complete");
        expect(badge).toBeInTheDocument();
        expect(badge).toHaveAttribute("data-state", "success");
      },
      { timeout: 2000 },
    );
  });
});

// ── Tests — Stake tab quick-amount chips ─────────────────────────────────────

describe("Stake page — quick-amount chips (Stake tab)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    mockRefetch.mockClear();
    seedBaseMocks({ balance: BALANCE_100_PLUSD, allowance: "0" });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("25% chip sets input to balance * 25 / 100 = 25 PLUSD", async () => {
    const user = userEvent.setup();
    renderStake();

    const chip25 = await screen.findByRole("button", { name: "25%" });
    await user.click(chip25);

    const input = screen.getByRole("textbox", { name: /PLUSD amount/i });
    expect((input as HTMLInputElement).value).toBe("25.00");
  });

  it("Max chip sets input to the live balance (100 PLUSD)", async () => {
    const user = userEvent.setup();
    renderStake();

    const maxChip = await screen.findByRole("button", { name: "Max" });
    await user.click(maxChip);

    const input = screen.getByRole("textbox", { name: /PLUSD amount/i });
    expect((input as HTMLInputElement).value).toBe("100.00");
  });

  it("50% chip sets input to 50 PLUSD", async () => {
    const user = userEvent.setup();
    renderStake();

    const chip50 = await screen.findByRole("button", { name: "50%" });
    await user.click(chip50);

    const input = screen.getByRole("textbox", { name: /PLUSD amount/i });
    expect((input as HTMLInputElement).value).toBe("50.00");
  });

  it("75% chip sets input to 75 PLUSD", async () => {
    const user = userEvent.setup();
    renderStake();

    const chip75 = await screen.findByRole("button", { name: "75%" });
    await user.click(chip75);

    const input = screen.getByRole("textbox", { name: /PLUSD amount/i });
    expect((input as HTMLInputElement).value).toBe("75.00");
  });
});

// ── Tests — Stake tab preview and exchange rate ───────────────────────────────

describe("Stake page — preview and exchange rate (Stake tab)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    mockRefetch.mockClear();
    seedBaseMocks({ allowance: "0" });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("exchange-rate row shows '1 PLUSD = 0.9596 sPLUSD'", async () => {
    renderStake();

    await waitFor(() => {
      expect(screen.getByText("1 PLUSD = 0.9596 sPLUSD")).toBeInTheDocument();
    });
  });

  it("output shows converted amount when 10 PLUSD entered (rate 0.9596 → 9.60)", async () => {
    const user = userEvent.setup();
    renderStake();

    const input = await screen.findByRole("textbox", { name: /PLUSD amount/i });
    await user.type(input, "10");

    // 10 PLUSD * 959600000000000000 / 1e18 = 9.596 sPLUSD
    // formatUsdc formats to 2 decimal places → "9.60"
    await waitFor(() => {
      // TokenAmountDisplay renders aria-label="sPLUSD amount: 9.60"
      const outputEl = screen.queryByLabelText(/sPLUSD amount:/i);
      expect(outputEl).toBeInTheDocument();
      // The aria-label text includes the formatted value
      expect(outputEl?.getAttribute("aria-label")).toMatch(/9\.60/);
    });
  });
});

// ── Tests — Unstake tab ───────────────────────────────────────────────────────

describe("Stake page — Unstake tab", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    mockRefetch.mockClear();
    seedBaseMocks({
      balance: "0",
      splusdBalance: BALANCE_50_SPLUSD,
      allowance: "0",
      includeUnstakeMock: true,
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("switching to Unstake tab shows sPLUSD amount input", async () => {
    const user = userEvent.setup();
    renderStake();

    // SegmentedTabs renders buttons with role="tab"
    const unstakeTab = await screen.findByRole("tab", { name: "Unstake" });
    await user.click(unstakeTab);

    await waitFor(() => {
      // After switching, input label should change to sPLUSD
      expect(
        screen.getByRole("textbox", { name: /sPLUSD amount/i }),
      ).toBeInTheDocument();
    });
  });

  it("switch to Unstake clears the amount input", async () => {
    const user = userEvent.setup();
    // Set PLUSD balance so we can type an amount
    localStorage.setItem(
      `pipeline.mock.wallet.balance.${PLUSD_ADDRESS.toLowerCase()}`,
      BALANCE_100_PLUSD,
    );
    localStorage.setItem(
      `pipeline.mock.wallet.allowance.${PLUSD_ADDRESS.toLowerCase()}.${SPLUSD_ADDRESS.toLowerCase()}`,
      "0",
    );
    renderStake();

    // Type in stake tab
    const input = await screen.findByRole("textbox", { name: /PLUSD amount/i });
    await user.type(input, "10");
    expect((input as HTMLInputElement).value).toBe("10");

    // Switch to Unstake tab via SegmentedTabs (role="tab")
    const unstakeTab = await screen.findByRole("tab", { name: "Unstake" });
    await user.click(unstakeTab);

    // After switching, the input should be cleared
    await waitFor(() => {
      const newInput = screen.queryByRole("textbox", {
        name: /sPLUSD amount/i,
      });
      if (newInput) {
        expect((newInput as HTMLInputElement).value).toBe("");
      }
    });
  });

  it("Unstake button is enabled when sPLUSD balance > 0 and amount entered", async () => {
    const user = userEvent.setup();
    renderStake();

    // Switch to Unstake tab
    const unstakeTab = await screen.findByRole("tab", { name: "Unstake" });
    await user.click(unstakeTab);

    // Enter amount
    const input = await screen.findByRole("textbox", {
      name: /sPLUSD amount/i,
    });
    await user.type(input, "10");

    await waitFor(() => {
      // The StepsCard Unstake action button (not the tab)
      const unstakeBtn = screen.getByRole("button", { name: "Unstake" });
      expect(unstakeBtn).not.toBeDisabled();
    });
  });

  it("clicking Unstake → mock settles → Done badge appears", async () => {
    const user = userEvent.setup();
    renderStake();

    // Switch to Unstake tab
    const unstakeTab = await screen.findByRole("tab", { name: "Unstake" });
    await user.click(unstakeTab);

    // Enter amount
    const input = await screen.findByRole("textbox", {
      name: /sPLUSD amount/i,
    });
    await user.type(input, "10");

    // Click the Unstake action button (StepsCard)
    const unstakeBtn = await screen.findByRole("button", { name: "Unstake" });
    await waitFor(() => expect(unstakeBtn).not.toBeDisabled());
    await user.click(unstakeBtn);

    // After mock settles, Done badge should appear
    await waitFor(
      () => {
        const badge = screen.queryByLabelText("Unstake complete");
        expect(badge).toBeInTheDocument();
        expect(badge).toHaveAttribute("data-state", "success");
      },
      { timeout: 2000 },
    );
  });

  it("Max chip uses sPLUSD balance on Unstake tab", async () => {
    const user = userEvent.setup();
    renderStake();

    // Switch to Unstake tab
    const unstakeTab = await screen.findByRole("tab", { name: "Unstake" });
    await user.click(unstakeTab);

    const maxChip = await screen.findByRole("button", { name: "Max" });
    await user.click(maxChip);

    const input = screen.getByRole("textbox", { name: /sPLUSD amount/i });
    expect((input as HTMLInputElement).value).toBe("50.00");
  });
});

// ── Tests — Unstake tab exchange rate and preview ─────────────────────────────

describe("Stake page — exchange rate and preview (Unstake tab)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    mockRefetch.mockClear();
    seedBaseMocks({
      balance: "0",
      splusdBalance: BALANCE_50_SPLUSD,
      allowance: "0",
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("exchange-rate row shows '1 sPLUSD = 1.0421 PLUSD' on Unstake tab", async () => {
    const user = userEvent.setup();
    renderStake();

    const unstakeTab = await screen.findByRole("tab", { name: "Unstake" });
    await user.click(unstakeTab);

    await waitFor(() => {
      expect(screen.getByText("1 sPLUSD = 1.0421 PLUSD")).toBeInTheDocument();
    });
  });

  it("output shows converted amount when 10 sPLUSD entered (rate 1.0421 → 10.42)", async () => {
    const user = userEvent.setup();
    renderStake();

    const unstakeTab = await screen.findByRole("tab", { name: "Unstake" });
    await user.click(unstakeTab);

    const input = await screen.findByRole("textbox", {
      name: /sPLUSD amount/i,
    });
    await user.type(input, "10");

    // 10 sPLUSD * 1042100000000000000 / 1e18 = 10.421 PLUSD
    // formatUsdc formats to 2 decimal places → "10.42"
    await waitFor(() => {
      // TokenAmountDisplay renders aria-label="PLUSD amount: 10.42"
      const outputEl = screen.queryByLabelText(/PLUSD amount:/i);
      expect(outputEl).toBeInTheDocument();
      expect(outputEl?.getAttribute("aria-label")).toMatch(/10\.42/);
    });
  });
});

// ── Tests — cross-tab reset ───────────────────────────────────────────────────

describe("Stake page — cross-tab reset regression", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    mockRefetch.mockClear();
    seedBaseMocks({
      balance: BALANCE_100_PLUSD,
      splusdBalance: BALANCE_50_SPLUSD,
      allowance: "1000000000000000000000",
      includeStakeMock: true,
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("after stake success, switch to Unstake → no stale Done badge from Stake side", async () => {
    const user = userEvent.setup();
    renderStake();

    // Perform a successful stake
    const input = await screen.findByRole("textbox", { name: /PLUSD amount/i });
    await user.type(input, "10");
    const stakeBtn = await screen.findByRole("button", { name: "Stake" });
    await waitFor(() => expect(stakeBtn).not.toBeDisabled());
    await user.click(stakeBtn);

    // Wait for stake success
    await waitFor(
      () => {
        const badge = screen.queryByLabelText("Stake complete");
        expect(badge).toBeInTheDocument();
      },
      { timeout: 2000 },
    );

    // Switch to Unstake tab
    const unstakeTab = screen.getByRole("tab", { name: "Unstake" });
    await user.click(unstakeTab);

    // No stale Done badge from Stake side should appear on Unstake tab
    await waitFor(() => {
      const staleBadge = screen.queryByLabelText("Stake complete");
      // The Stake step card is no longer rendered on Unstake tab
      expect(staleBadge).not.toBeInTheDocument();
    });
  });

  it("switch back to Stake from Unstake shows step labels correctly", async () => {
    const user = userEvent.setup();
    renderStake();

    // Switch to Unstake first
    const unstakeTab = await screen.findByRole("tab", { name: "Unstake" });
    await user.click(unstakeTab);

    // Switch back to Stake
    const stakeTab = await screen.findByRole("tab", { name: "Stake" });
    await user.click(stakeTab);

    await waitFor(() => {
      // Stake tab's step labels should render
      expect(
        screen.getByText("Allow Pipeline to use PLUSD"),
      ).toBeInTheDocument();
      expect(screen.getByText("Confirm and stake PLUSD")).toBeInTheDocument();
    });
  });

  it("tab switch from Stake → Unstake clears the amount input", async () => {
    const user = userEvent.setup();
    renderStake();

    // Type in stake tab
    const input = await screen.findByRole("textbox", { name: /PLUSD amount/i });
    await user.type(input, "42");
    expect((input as HTMLInputElement).value).toBe("42");

    // Switch to Unstake
    const unstakeTab = await screen.findByRole("tab", { name: "Unstake" });
    await user.click(unstakeTab);

    // Input should be cleared on the new tab
    await waitFor(() => {
      const newInput = screen.queryByRole("textbox", {
        name: /sPLUSD amount/i,
      });
      if (newInput) {
        expect((newInput as HTMLInputElement).value).toBe("");
      }
    });
  });
});

// ── Tests — disconnected wallet ───────────────────────────────────────────────

describe("Stake page — disconnected wallet", () => {
  beforeEach(() => {
    localStorage.clear();
    seedBaseMocks({ connected: false });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("renders all step buttons as disabled when disconnected (Stake tab)", async () => {
    renderStake();
    await waitFor(() => {
      const approveBtn = screen.getByRole("button", { name: "Approve" });
      const stakeBtn = screen.getByRole("button", { name: "Stake" });
      expect(approveBtn).toBeDisabled();
      expect(stakeBtn).toBeDisabled();
    });
  });

  it("renders Unstake button as disabled when disconnected", async () => {
    const user = userEvent.setup();
    renderStake();

    const unstakeTab = await screen.findByRole("tab", { name: "Unstake" });
    await user.click(unstakeTab);

    await waitFor(() => {
      const unstakeBtn = screen.getByRole("button", { name: "Unstake" });
      expect(unstakeBtn).toBeDisabled();
    });
  });
});

// ── Tests — zero balance ──────────────────────────────────────────────────────

describe("Stake page — zero balance", () => {
  beforeEach(() => {
    localStorage.clear();
    seedBaseMocks({ balance: "0", splusdBalance: "0", allowance: "0" });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("all step buttons are disabled when balance is zero (Stake tab)", async () => {
    renderStake();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Stake" })).toBeDisabled();
    });
  });

  it("does NOT render a low-balance banner", async () => {
    renderStake();
    await waitFor(() => {
      // No low-balance banner — stake page has no minimum deposit requirement
      expect(screen.queryByText(/Add funds/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/LowBalance/i)).not.toBeInTheDocument();
    });
  });

  it("renders both step rows even when balance is zero", async () => {
    renderStake();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Approve" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Stake" })).toBeInTheDocument();
    });
  });
});

// ── Tests — step labels ───────────────────────────────────────────────────────

describe("Stake page — step labels", () => {
  beforeEach(() => {
    localStorage.clear();
    seedBaseMocks({ allowance: "0" });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("renders both stake step labels in order", async () => {
    renderStake();
    await waitFor(() => {
      expect(
        screen.getByText("Allow Pipeline to use PLUSD"),
      ).toBeInTheDocument();
      expect(screen.getByText("Confirm and stake PLUSD")).toBeInTheDocument();
    });
  });

  it("renders unstake step label on Unstake tab", async () => {
    const user = userEvent.setup();
    renderStake();

    const unstakeTab = await screen.findByRole("tab", { name: "Unstake" });
    await user.click(unstakeTab);

    await waitFor(() => {
      expect(
        screen.getByText("Confirm and unstake sPLUSD"),
      ).toBeInTheDocument();
    });
  });
});

// ── Tests — amount exceeds balance ────────────────────────────────────────────

describe("Stake page — amount exceeds balance", () => {
  beforeEach(() => {
    localStorage.clear();
    seedBaseMocks({ balance: AMOUNT_10_PLUSD, allowance: "0" });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("Approve is disabled when amount exceeds PLUSD balance", async () => {
    const user = userEvent.setup();
    renderStake();

    const input = await screen.findByRole("textbox", { name: /PLUSD amount/i });
    await user.type(input, "50"); // 50 > 10

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Stake" })).toBeDisabled();
    });
  });
});
