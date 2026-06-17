/**
 * Integration tests for the / (home) route.
 *
 * All blockchain state is seeded via the `pipeline.mock.wallet.*` localStorage
 * keys — no real wagmi calls are made. The same mock layer used in the
 * dev-server DevTools is exercised here, so the tests stay close to real usage.
 *
 * Scenarios covered:
 *   1. Disconnected → ConnectWalletPromoCard renders; click invokes connect().
 *   2. Connected (via mock) → PortfolioPlaceholderCard renders; $0.00 visible;
 *      "Get PLUSD to start" link is present; ConnectWallet promo is absent.
 *   3. SegmentedTabs default + click: default tab is "7D"; clicking "1M" makes
 *      it the active tab; no data fetch occurs.
 *   4. Card height parity: both cards carry the `min-h-[274px]` utility class.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EvmWalletProvider } from "@/wallet/evm/EvmWalletProvider";
import { Route } from "./index";

// ── Wagmi / AppKit mocks ──────────────────────────────────────────────────────

const mockOpen = vi.fn();

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
    useReadContract: vi.fn(() => ({
      data: undefined,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })),
    useWriteContract: vi.fn(() => ({
      writeContract: vi.fn(),
      data: undefined,
      isPending: false,
      isSuccess: false,
      error: null,
      reset: vi.fn(),
    })),
    useWaitForTransactionReceipt: vi.fn(() => ({
      data: undefined,
      isLoading: false,
      isSuccess: false,
      error: null,
    })),
    usePublicClient: vi.fn(() => undefined),
  };
});

vi.mock("@reown/appkit/react", () => ({
  createAppKit: vi.fn(),
  useAppKit: vi.fn(() => ({ open: mockOpen })),
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
// The home route uses <Link to="/deposit"> inside PortfolioPlaceholderCard.
// We render Link as an <a> passthrough so href assertions work without a real
// router tree.

// A shared navigate spy so tests can assert calls on it.
const mockNavigate = vi.fn();

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...original,
    useNavigate: vi.fn(() => mockNavigate),
    useRouterState: vi.fn(() => "/"),
    createFileRoute: original.createFileRoute,
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
  };
});

// ── ENV mock ──────────────────────────────────────────────────────────────────

const mockEnv = vi.hoisted(() => ({
  EVM_CHAIN_ID: 560048,
  EVM_RPC_URL: "https://ethereum-hoodi-rpc.publicnode.com",
  DEPOSIT_MANAGER_ADDRESS:
    "0x3333000000000000000000000000000000000003" as `0x${string}`,
  STAKED_PLUSD_ADDRESS:
    "0x0000000000000000000000000000000000000000" as `0x${string}`,
  WALLETCONNECT_PROJECT_ID: "replace-me",
}));

vi.mock("@/lib/env", () => ({
  ENV: mockEnv,
}));

// ── API module mock ───────────────────────────────────────────────────────────
// RecentActivityCard and other children call useRequests. Return empty data so
// they render without blowing up; the test only asserts the top-left card slot.

vi.mock("@/api", () => ({
  useRequests: () => ({ data: undefined, isLoading: false, error: null }),
  useStats: () => ({ data: undefined, isLoading: false, error: null }),
  formatApy: () => "—",
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const WALLET_ADDRESS = "0x1234000000000000000000000000000000000001";

function renderHome() {
  const HomePage = Route.options.component as React.ComponentType;
  return render(
    <EvmWalletProvider>
      <HomePage />
    </EvmWalletProvider>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Home page — disconnected state", () => {
  beforeEach(() => {
    localStorage.clear();
    mockOpen.mockClear();
    mockNavigate.mockClear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("renders without throwing", () => {
    expect(() => renderHome()).not.toThrow();
  });

  it("shows ConnectWalletPromoCard heading", async () => {
    // Both mobile and desktop blocks render ConnectWalletPromoCard when
    // disconnected; check that at least one heading is present.
    renderHome();
    await waitFor(() => {
      const headings = screen.getAllByRole("heading", {
        name: "Connect Wallet",
      });
      expect(headings.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("PortfolioPlaceholderCard is absent", async () => {
    renderHome();
    await waitFor(() => {
      expect(screen.queryByText("Total Balance")).not.toBeInTheDocument();
    });
  });

  it("clicking Connect calls useWallet().connect() → opens AppKit modal (when ack flag is pre-set)", async () => {
    // Pre-seed the terms acknowledgement so the gate is skipped and AppKit
    // is called directly. The gate modal itself is tested in FirstConnectionModal.test.tsx
    // and useWallet.test.tsx.
    localStorage.setItem("pipeline.wallet.termsAcknowledged.pending", "true");

    const user = userEvent.setup();
    renderHome();

    // Both mobile and desktop blocks render a "Connect" button; click the first.
    const connectBtns = await screen.findAllByRole("button", {
      name: "Connect",
    });
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await user.click(connectBtns[0]!);

    // useWallet().connect() delegates to useAppKit().open()
    await waitFor(() => {
      expect(mockOpen).toHaveBeenCalledTimes(1);
    });
  });

  it("clicking Buy navigates to /deposit with direction=deposit", async () => {
    const user = userEvent.setup();
    renderHome();

    // Both mobile and desktop blocks render StartHereCard; click the first Buy.
    const buyBtns = await screen.findAllByRole("button", { name: "Buy" });
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await user.click(buyBtns[0]!);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/deposit",
        search: { direction: "deposit" },
      });
    });
  });

  it("clicking Sell navigates to /deposit?direction=withdraw", async () => {
    const user = userEvent.setup();
    renderHome();

    // Both mobile and desktop blocks render StartHereCard.
    // Since #476, the mobile Sell (index 0, renders first in DOM) is intentionally
    // disabled + dimmed when the wallet is disconnected (mobileHomeState="empty").
    // The desktop Sell (index 1) remains enabled and is used for navigation.
    const sellBtns = await screen.findAllByRole("button", { name: "Sell" });
    expect(sellBtns.length).toBeGreaterThanOrEqual(2);
    // Mobile instance must be disabled in disconnected state.
    expect(sellBtns[0]).toBeDisabled();
    // Desktop instance must be enabled.
    expect(sellBtns[1]).not.toBeDisabled();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await user.click(sellBtns[1]!);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/deposit",
        search: { direction: "withdraw" },
      });
    });
  });

  it("Stake button is enabled when wallet is disconnected (regardless of PLUSD balance)", async () => {
    // Disconnected state — no PLUSD address or balance seeded.
    // The CTA must be enabled so the user can navigate to /stake.
    // Both the mobile and desktop StakeCards render; we check the first one.
    renderHome();

    await waitFor(() => {
      const stakeBtns = screen.getAllByRole("button", { name: "Stake PLUSD" });
      expect(stakeBtns.length).toBeGreaterThanOrEqual(1);
      expect(stakeBtns[0]).not.toBeDisabled();
    });
  });

  it("clicking Stake navigates to /stake when disconnected", async () => {
    const user = userEvent.setup();
    renderHome();

    // Both mobile and desktop blocks render StakeCards in the disconnected
    // state; click the first one found (desktop-grid card).
    const stakeBtns = await screen.findAllByRole("button", {
      name: "Stake PLUSD",
    });
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await user.click(stakeBtns[0]!);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({ to: "/stake" });
    });
  });

  it("clicking Stake navigates to /stake when wallet has PLUSD balance", async () => {
    // Seed a PLUSD address via the named alias and seed a non-zero balance.
    const PLUSD_ADDRESS = "0xaaaa000000000000000000000000000000000001";
    localStorage.setItem(
      "pipeline.mock.wallet.contract.stakedPlusd.asset",
      PLUSD_ADDRESS,
    );
    localStorage.setItem(
      `pipeline.mock.wallet.balance.${PLUSD_ADDRESS}`,
      "1000000000000000000",
    );

    const user = userEvent.setup();
    renderHome();

    // Both mobile and desktop blocks render StakeCards in the disconnected
    // state; click the first one found (desktop-grid card).
    const stakeBtns = await screen.findAllByRole("button", {
      name: "Stake PLUSD",
    });
    expect(stakeBtns[0]).not.toBeDisabled();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await user.click(stakeBtns[0]!);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({ to: "/stake" });
    });
  });
});

describe("Home page — connected state (mock)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockOpen.mockClear();
    // Simulate a connected wallet via the mock layer (same pattern as deposit tests)
    localStorage.setItem("pipeline.mock.wallet.isConnected", "true");
    localStorage.setItem("pipeline.mock.wallet.address", WALLET_ADDRESS);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("shows PortfolioPlaceholderCard — 'Total Balance' heading", async () => {
    // Both mobile and desktop blocks render the Total Balance text; check for
    // at least one instance.
    renderHome();
    await waitFor(() => {
      const elements = screen.getAllByText("Total Balance");
      expect(elements.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows '$0.00' balance literal", async () => {
    // Both mobile (State A) and desktop render $0.00; at least one must appear.
    renderHome();
    await waitFor(() => {
      const headings = screen.getAllByRole("heading", { name: "$0.00" });
      expect(headings.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("'Get PLUSD to start' link is present and points to /deposit", async () => {
    // Both mobile and desktop blocks render this link; check the first one.
    renderHome();
    const links = await screen.findAllByRole("link", {
      name: "Get PLUSD to start",
    });
    expect(links.length).toBeGreaterThanOrEqual(1);
    expect(links[0]).toHaveAttribute("href", "/deposit");
  });

  it("ConnectWalletPromoCard is absent", async () => {
    renderHome();
    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: "Connect Wallet" }),
      ).not.toBeInTheDocument();
    });
  });

  it("Stake button is disabled when connected with zero PLUSD balance", async () => {
    // Connected but no PLUSD balance seeded — stakeDisabled should be true.
    // The desktop block renders "Stake PLUSD" button (disabled); the mobile block
    // renders "Nothing to Stake" button. Check the desktop one.
    renderHome();

    const stakeBtn = await screen.findByRole("button", { name: "Stake PLUSD" });
    expect(stakeBtn).toBeDisabled();
  });
});

describe("Home page — SegmentedTabs default + click semantics", () => {
  beforeEach(() => {
    localStorage.clear();
    mockOpen.mockClear();
    localStorage.setItem("pipeline.mock.wallet.isConnected", "true");
    localStorage.setItem("pipeline.mock.wallet.address", WALLET_ADDRESS);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("default active tab is '7D'", async () => {
    // Both mobile and desktop blocks render PortfolioPlaceholderCard in
    // the connected state; check the first "7D" tab found.
    renderHome();
    await waitFor(() => {
      const tabs = screen.getAllByRole("tab", { name: "7D" });
      expect(tabs.length).toBeGreaterThanOrEqual(1);
      expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    });
  });

  it("other tabs default to inactive", async () => {
    renderHome();
    await waitFor(() => {
      const tabs1m = screen.getAllByRole("tab", { name: "1M" });
      expect(tabs1m.length).toBeGreaterThanOrEqual(1);
      expect(tabs1m[0]).toHaveAttribute("aria-selected", "false");
    });
  });

  it("clicking '1M' makes it the active tab and deactivates '7D'", async () => {
    const user = userEvent.setup();
    renderHome();

    // Click the first "1M" tab found.
    const tabs1m = await screen.findAllByRole("tab", { name: "1M" });
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await user.click(tabs1m[0]!);

    await waitFor(() => {
      // At least one "1M" tab should now be active.
      const active1mTabs = screen.getAllByRole("tab", { name: "1M" });
      expect(active1mTabs[0]).toHaveAttribute("aria-selected", "true");
      // The corresponding "7D" tab (in the same tablist) should be inactive.
      const tabs7d = screen.getAllByRole("tab", { name: "7D" });
      expect(tabs7d[0]).toHaveAttribute("aria-selected", "false");
    });
  });

  it("switching tabs does not call useAppKit().open (no navigation triggered)", async () => {
    const user = userEvent.setup();
    renderHome();

    const tabs3m = await screen.findAllByRole("tab", { name: "3M" });
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await user.click(tabs3m[0]!);

    // open() was not called (tab switch is purely visual, no wallet action)
    expect(mockOpen).not.toHaveBeenCalled();
  });
});

describe("Home page — card height parity (disconnected)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("ConnectWalletPromoCard carries min-h-[274px] when disconnected", async () => {
    // Both mobile and desktop blocks render ConnectWalletPromoCard; check
    // that at least one card has the min-h class.
    renderHome();

    await waitFor(() => {
      const cards = screen.getAllByRole("region", { name: "Connect Wallet" });
      expect(cards.some((c) => c.className.includes("min-h-[274px]"))).toBe(
        true,
      );
    });
  });
});

describe("Home page — card height parity (connected)", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("pipeline.mock.wallet.isConnected", "true");
    localStorage.setItem("pipeline.mock.wallet.address", WALLET_ADDRESS);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("PortfolioPlaceholderCard carries min-h-[274px] when connected", async () => {
    // Both mobile and desktop blocks render PortfolioPlaceholderCard; check
    // that the desktop card (which has min-h-[274px]) is present.
    renderHome();

    await waitFor(() => {
      const cards = screen.getAllByRole("region", { name: "$0.00" });
      expect(cards.some((c) => c.className.includes("min-h-[274px]"))).toBe(
        true,
      );
    });
  });
});

// ── Mobile connected balance states (States A / B / C) ────────────────────────
//
// Mock seeding convention (same as deposit tests):
//   - `pipeline.mock.wallet.isConnected` = "true"
//   - `pipeline.mock.wallet.address` = WALLET_ADDRESS
//   - `pipeline.mock.wallet.contract.stakedPlusd.asset` = PLUSD_ADDRESS
//   - `pipeline.mock.wallet.balance.<PLUSD_ADDRESS>` = "<bigint>" (18-dec string)
//   - `pipeline.mock.wallet.balance.<STAKED_PLUSD_ADDRESS>` = "<bigint>" (18-dec)
//   - `pipeline.mock.wallet.contract.stakedPlusd.convertToAssets` = "<rate>"
//
// Since JSDOM does not apply CSS media queries, both the `md:hidden` mobile block
// and the `hidden md:block` desktop block are in the DOM simultaneously.
// Assertions target text content / button names that are unique to the mobile
// connected state (e.g. "Nothing to Stake", "Staked PLUSD", "Nothing yet", etc.)
// or use `getAllBy*` where content appears in both blocks.

const PLUSD_ADDRESS = "0xaaaa000000000000000000000000000000000002";
const STAKED_PLUSD_ADDRESS = "0x0000000000000000000000000000000000000000";

describe("Home page — mobile State A: connected, 0 PLUSD, 0 sPLUSD", () => {
  beforeEach(() => {
    localStorage.clear();
    mockOpen.mockClear();
    mockNavigate.mockClear();
    localStorage.setItem("pipeline.mock.wallet.isConnected", "true");
    localStorage.setItem("pipeline.mock.wallet.address", WALLET_ADDRESS);
    // Seed PLUSD address but no balance (zero balance).
    localStorage.setItem(
      "pipeline.mock.wallet.contract.stakedPlusd.asset",
      PLUSD_ADDRESS,
    );
    // sPLUSD address uses the env default (zero address, balance undefined).
    // No balance keys → all balances resolve as undefined → State A.
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("greeting shows 'Welcome back' text on mobile", async () => {
    renderHome();
    // The mobile span renders "Welcome back" when isConnected=true.
    await waitFor(() => {
      expect(screen.getByText("Welcome back")).toBeInTheDocument();
    });
  });

  it("mobile StakeCard shows 'Nothing to Stake' button (State A)", async () => {
    renderHome();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Nothing to Stake" }),
      ).toBeInTheDocument();
    });
  });

  it("mobile StakeCard 'Nothing to Stake' button is disabled (State A)", async () => {
    renderHome();
    await waitFor(() => {
      const btn = screen.getByRole("button", { name: "Nothing to Stake" });
      expect(btn).toBeDisabled();
    });
  });

  it("mobile EarnedCard shows 'Nothing yet' (State A)", async () => {
    renderHome();
    await waitFor(() => {
      const elements = screen.getAllByText("Nothing yet");
      expect(elements.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("mobile RecentActivityCard is absent in State A", async () => {
    // Per issue #466 Q6: if no activity, the entire block is hidden.
    // In State A (empty) the card is not rendered at all in the mobile block.
    // The desktop block still renders it so we check for the mobile-block
    // absence by checking the total count matches only the desktop instance.
    renderHome();
    await waitFor(() => {
      // The desktop block always has a RecentActivityCard; the mobile block
      // should NOT have one in State A. We verify only one instance exists.
      const cards = screen.getAllByRole("region", {
        name: "Recent activity",
      });
      // Only the desktop card should be present (mobile one is not rendered).
      expect(cards).toHaveLength(1);
    });
  });
});

describe("Home page — mobile State B: connected, has PLUSD, 0 sPLUSD", () => {
  beforeEach(() => {
    localStorage.clear();
    mockOpen.mockClear();
    mockNavigate.mockClear();
    localStorage.setItem("pipeline.mock.wallet.isConnected", "true");
    localStorage.setItem("pipeline.mock.wallet.address", WALLET_ADDRESS);
    localStorage.setItem(
      "pipeline.mock.wallet.contract.stakedPlusd.asset",
      PLUSD_ADDRESS,
    );
    // Seed non-zero PLUSD balance (1000 PLUSD = 1000 * 10^18).
    localStorage.setItem(
      `pipeline.mock.wallet.balance.${PLUSD_ADDRESS}`,
      "1000000000000000000000",
    );
    // sPLUSD balance remains zero (not seeded).
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("greeting shows 'Welcome back' in State B", async () => {
    renderHome();
    await waitFor(() => {
      expect(screen.getByText("Welcome back")).toBeInTheDocument();
    });
  });

  it("mobile StartHereCard shows 'PLUSD Balance' eyebrow (State B)", async () => {
    renderHome();
    await waitFor(() => {
      const elements = screen.getAllByText("PLUSD Balance");
      expect(elements.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("mobile StartHereCard shows '$X USDC' sub-line (State B)", async () => {
    renderHome();
    await waitFor(() => {
      const subLine = screen.getByTestId("plusd-in-usdc");
      expect(subLine).toBeInTheDocument();
      expect(subLine.textContent).toMatch(/\$[\d,]+\.\d{2} USDC/);
    });
  });

  it("mobile StakeCard 'Stake' button is enabled (State B)", async () => {
    // In State B, both the mobile 'Stake' button (mobileHomeState="plusd") and
    // the desktop 'Stake PLUSD' button should be enabled.
    renderHome();

    await waitFor(() => {
      const stakeBtns = screen.getAllByRole("button", { name: "Stake PLUSD" });
      // Desktop button should be enabled (has PLUSD balance).
      expect(stakeBtns[0]).not.toBeDisabled();
    });
  });

  it("mobile EarnedCard shows 'Nothing yet' (State B)", async () => {
    renderHome();
    await waitFor(() => {
      const elements = screen.getAllByText("Nothing yet");
      expect(elements.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("mobile RecentActivityCard is rendered in State B", async () => {
    // Per issue #466 Q6: activity block is shown when connected with balance.
    // In State B, the mobile block renders RecentActivityCard.
    renderHome();
    await waitFor(() => {
      const cards = screen.getAllByRole("region", { name: "Recent activity" });
      // Both mobile and desktop blocks render the card.
      expect(cards.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("'Stake PLUSD to start earning' link present in mobile portfolio card (State B)", async () => {
    renderHome();
    await waitFor(() => {
      const links = screen.getAllByRole("link", {
        name: "Stake PLUSD to start earning",
      });
      expect(links.length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe("Home page — mobile State C: connected, has sPLUSD", () => {
  const SPLUSD_ADDRESS = STAKED_PLUSD_ADDRESS; // zero address (env default)

  beforeEach(() => {
    localStorage.clear();
    mockOpen.mockClear();
    mockNavigate.mockClear();
    localStorage.setItem("pipeline.mock.wallet.isConnected", "true");
    localStorage.setItem("pipeline.mock.wallet.address", WALLET_ADDRESS);
    localStorage.setItem(
      "pipeline.mock.wallet.contract.stakedPlusd.asset",
      PLUSD_ADDRESS,
    );
    // Seed PLUSD balance.
    localStorage.setItem(
      `pipeline.mock.wallet.balance.${PLUSD_ADDRESS}`,
      "1000000000000000000000",
    );
    // Seed sPLUSD balance via the zero-address token key.
    localStorage.setItem(
      `pipeline.mock.wallet.balance.${SPLUSD_ADDRESS}`,
      "1000000000000000000000",
    );
    // Seed convertToAssets rate: 1.0428 PLUSD per 1 sPLUSD (18-decimal).
    localStorage.setItem(
      "pipeline.mock.wallet.contract.stakedPlusd.convertToAssets",
      "1042800000000000000",
    );
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("greeting shows 'Welcome back' in State C", async () => {
    renderHome();
    await waitFor(() => {
      expect(screen.getByText("Welcome back")).toBeInTheDocument();
    });
  });

  it("mobile StartHereCard shows '$X USDC' sub-line (State C)", async () => {
    renderHome();
    await waitFor(() => {
      const subLine = screen.getByTestId("plusd-in-usdc");
      expect(subLine).toBeInTheDocument();
      expect(subLine.textContent).toMatch(/\$[\d,]+\.\d{2} USDC/);
    });
  });

  it("mobile StakeCard shows 'Staked PLUSD' label (State C)", async () => {
    renderHome();
    await waitFor(() => {
      const elements = screen.getAllByText("Staked PLUSD");
      expect(elements.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("mobile StakeCard shows 'Stake More' CTA (State C)", async () => {
    renderHome();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Stake More PLUSD" }),
      ).toBeInTheDocument();
    });
  });

  it("mobile StakeCard shows 'Unstake' link (State C)", async () => {
    renderHome();
    await waitFor(() => {
      expect(screen.getByTestId("unstake-link")).toBeInTheDocument();
    });
  });

  it("mobile EarnedCard shows '—' placeholder (State C)", async () => {
    renderHome();
    await waitFor(() => {
      // "—" is the placeholder earned value for State C.
      const elements = screen.getAllByText("—");
      expect(elements.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("mobile RecentActivityCard is rendered in State C", async () => {
    renderHome();
    await waitFor(() => {
      const cards = screen.getAllByRole("region", { name: "Recent activity" });
      expect(cards.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("sPLUSD shares display is present in State C", async () => {
    renderHome();
    await waitFor(() => {
      const sharesEl = screen.getByTestId("splusd-shares");
      expect(sharesEl).toBeInTheDocument();
      // 1000 sPLUSD shares at 18 decimals.
      expect(sharesEl.textContent).toContain("1,000.00");
    });
  });
});
