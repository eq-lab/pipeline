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
import React, { useEffect } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EvmWalletProvider } from "@/wallet/evm/EvmWalletProvider";
import { WalletViewProvider, useWalletView } from "@/wallet";
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

// ── Stellar kit mock ──────────────────────────────────────────────────────────
// Mock the Stellar wallet kit singleton so tests don't try to initialise the
// real kit (which requires DOM extension points from the browser wallet
// extensions). The mock exposes only the methods useStellarWallet calls.
vi.mock("@/wallet/stellar/config", () => ({
  StellarWalletsKit: {
    init: vi.fn(),
    getAddress: vi.fn(async () => ({ address: undefined })),
    authModal: vi.fn(async () => ({ address: undefined })),
    disconnect: vi.fn(async () => {}),
    signTransaction: vi.fn(async () => ({ signedTxXdr: "" })),
    setWallet: vi.fn(),
    fetchAddress: vi.fn(async () => ({ address: undefined })),
  },
}));

// Disconnected CTAs open the shared ConnectWalletModal via useConnectModal()
// (issues #638/#645) rather than calling AppKit directly. The gate/modal
// behavior is covered by ConnectModalProvider.test.tsx; here we only assert the
// Home CTA is wired to useConnectModal().open().
const mockConnectModalOpen = vi.fn();
vi.mock("@/wallet", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/wallet")>()),
  useConnectModal: () => ({ open: mockConnectModalOpen, close: vi.fn() }),
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
    // Mock useQuery so the Stellar hooks added in #688 (useStellarSacToken,
    // useStellarStakedPlusdBalance, useStellarUnstakeConvertToAssets,
    // useStellarDepositManagerAddresses) don't throw "No QueryClient set".
    // Tests that need real hook behaviour seed localStorage mock keys instead
    // (the hooks short-circuit to the mock fast-path before useQuery runs).
    useQuery: vi.fn(() => ({
      data: undefined,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })),
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

/**
 * Helper that switches the WalletViewContext to "stellar" before rendering the
 * Home page. Uses a real WalletViewProvider — same pattern as deposit tests.
 */
function StellarViewSwitcher({ children }: { children: React.ReactNode }) {
  const { setKind } = useWalletView();
  useEffect(() => {
    setKind("stellar");
  }, [setKind]);
  return <>{children}</>;
}

function renderHomeStellar() {
  const HomePage = Route.options.component as React.ComponentType;
  return render(
    <EvmWalletProvider>
      <WalletViewProvider>
        <StellarViewSwitcher>
          <HomePage />
        </StellarViewSwitcher>
      </WalletViewProvider>
    </EvmWalletProvider>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Home page — disconnected state", () => {
  beforeEach(() => {
    localStorage.clear();
    mockOpen.mockClear();
    mockConnectModalOpen.mockClear();
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

  it("clicking Connect opens the shared ConnectWalletModal via useConnectModal().open()", async () => {
    const user = userEvent.setup();
    renderHome();

    // Both mobile and desktop blocks render a "Connect" button; click the first.
    const connectBtns = await screen.findAllByRole("button", {
      name: "Connect",
    });
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await user.click(connectBtns[0]!);

    // The Home CTA's onConnect is wired to useConnectModal().open(), which
    // routes through the terms gate and opens ConnectWalletModal (issues
    // #638/#645). It no longer calls AppKit's open() directly.
    await waitFor(() => {
      expect(mockConnectModalOpen).toHaveBeenCalledTimes(1);
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

// ── Stellar connection gate regression tests (#684) ───────────────────────────
//
// These tests guard the fix for #684: when view kind is "stellar" the home page
// must use stellar.isConnected (not evm.isConnected) to decide which card to
// render in the top-left slot.
//
// Mock seeding convention (Stellar):
//   pipeline.mock.wallet.stellar.address   — 56-char Stellar public key (G…)
//   pipeline.mock.wallet.stellar.isConnected — "true" / "false"
//
// renderHomeStellar() wraps the page in <WalletViewProvider> and switches view
// kind to "stellar" before the component renders, exactly mirroring the deposit-
// page Stellar test pattern.

const STELLAR_MOCK_ADDRESS =
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

describe("Home page — Stellar-only connected (regression #684)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockOpen.mockClear();
    // Seed a connected Stellar wallet; EVM wallet remains disconnected (default).
    localStorage.setItem(
      "pipeline.mock.wallet.stellar.address",
      STELLAR_MOCK_ADDRESS,
    );
    localStorage.setItem("pipeline.mock.wallet.stellar.isConnected", "true");
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("renders connected layout (PortfolioPlaceholderCard) — not the promo card", async () => {
    // Regression guard for #684: stellar-only session must see connected view.
    renderHomeStellar();
    await waitFor(() => {
      const portfolioCards = screen.getAllByTestId(
        "home-portfolio-placeholder",
      );
      expect(portfolioCards.length).toBeGreaterThanOrEqual(1);
    });
    // Promo card must be absent.
    expect(
      screen.queryByTestId("home-connect-wallet-card"),
    ).not.toBeInTheDocument();
  });

  it("ConnectWalletPromoCard is absent when Stellar is connected", async () => {
    renderHomeStellar();
    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: "Connect Wallet" }),
      ).not.toBeInTheDocument();
    });
  });

  it("shows 'Total Balance' heading (connected layout)", async () => {
    renderHomeStellar();
    await waitFor(() => {
      const elements = screen.getAllByText("Total Balance");
      expect(elements.length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe("Home page — EVM-only connected, Stellar view (view-kind semantics)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockOpen.mockClear();
    // EVM wallet connected, Stellar wallet disconnected.
    localStorage.setItem("pipeline.mock.wallet.isConnected", "true");
    localStorage.setItem("pipeline.mock.wallet.address", WALLET_ADDRESS);
    // Stellar is NOT seeded → stellar.isConnected === false.
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("shows disconnected promo card when Stellar view active but Stellar not connected", async () => {
    // Documents the view-kind semantics: active view (stellar) is disconnected
    // even though EVM is connected. The home page shows the promo card.
    renderHomeStellar();
    await waitFor(() => {
      const headings = screen.getAllByRole("heading", {
        name: "Connect Wallet",
      });
      expect(headings.length).toBeGreaterThanOrEqual(1);
    });
    expect(
      screen.queryByTestId("home-portfolio-placeholder"),
    ).not.toBeInTheDocument();
  });
});

describe("Home page — EVM-only connected, EVM view (no regression)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockOpen.mockClear();
    localStorage.setItem("pipeline.mock.wallet.isConnected", "true");
    localStorage.setItem("pipeline.mock.wallet.address", WALLET_ADDRESS);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("still shows connected layout when EVM is connected and view kind is EVM", async () => {
    // renderHome() uses the default EVM view (no WalletViewProvider override).
    renderHome();
    await waitFor(() => {
      const elements = screen.getAllByText("Total Balance");
      expect(elements.length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe("Home page — neither connected, Stellar view (disconnected promo)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockOpen.mockClear();
    // Neither EVM nor Stellar seeded → both disconnected.
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("shows disconnected promo card when neither chain is connected (Stellar view)", async () => {
    renderHomeStellar();
    await waitFor(() => {
      const headings = screen.getAllByRole("heading", {
        name: "Connect Wallet",
      });
      expect(headings.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("PortfolioPlaceholderCard absent when disconnected (Stellar view)", async () => {
    renderHomeStellar();
    await waitFor(() => {
      expect(screen.queryByText("Total Balance")).not.toBeInTheDocument();
    });
  });
});

// ── Stellar connected balances (#688) ─────────────────────────────────────────
//
// Mock seeding convention (Stellar balances, 7-decimal SAC scale):
//   pipeline.mock.wallet.stellar.address      — 56-char public key (G…)
//   pipeline.mock.wallet.stellar.isConnected  — "true"
//   pipeline.mock.wallet.stellar.balance.sac.plusd
//       — Raw bigint string (7-dec): "10000000" = 1 PLUSD
//   pipeline.mock.wallet.stellar.stakedPlusd.shareBalance
//       — Raw bigint string (7-dec): "10000000" = 1 sPLUSD
//   pipeline.mock.wallet.stellar.stakedPlusd.convertToAssets
//       — Rate at SAC 1e7 scale: output = (shares * rate) / 1e7
//         e.g. "10400000" → 1 sPLUSD → 1.04 PLUSD
//
// renderHomeStellar() wraps the page in <WalletViewProvider> and switches view
// kind to "stellar". Note: useQuery is mocked to return { data: undefined };
// hooks rely on their localStorage mock fast-paths (which run before useQuery).

describe("Home page — Stellar connected balances (#688)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockOpen.mockClear();
    mockNavigate.mockClear();
    // Connect the Stellar wallet.
    localStorage.setItem(
      "pipeline.mock.wallet.stellar.address",
      STELLAR_MOCK_ADDRESS,
    );
    localStorage.setItem("pipeline.mock.wallet.stellar.isConnected", "true");
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("Case 1: has PLUSD, 0 sPLUSD — Total Balance reflects PLUSD, Stake enabled, mobile state plusd", async () => {
    // Seed 500 PLUSD at 7-decimal scale: 500 * 10^7 = 5_000_000_000n
    localStorage.setItem(
      "pipeline.mock.wallet.stellar.balance.sac.plusd",
      "5000000000",
    );
    // No sPLUSD seeded → zero shares.

    renderHomeStellar();

    await waitFor(() => {
      // Total Balance should NOT be $0.00 (PLUSD balance present).
      const headings = screen.getAllByRole("heading");
      const balanceHeading = headings.find(
        (h) => h.textContent && /\$[\d,]+\.\d{2}/.test(h.textContent),
      );
      expect(balanceHeading).not.toBeUndefined();
      // The balance rendered must not be $0.00.
      expect(balanceHeading?.textContent).not.toBe("$0.00");
    });

    // Stake CTA should be enabled (has PLUSD).
    await waitFor(() => {
      // Desktop StakeCard shows "Stake PLUSD" button when stakeDisabled=false.
      const stakeBtns = screen.getAllByRole("button", { name: "Stake PLUSD" });
      expect(stakeBtns.length).toBeGreaterThanOrEqual(1);
      // Desktop button (index 0 in connected layout) should be enabled.
      expect(stakeBtns[0]).not.toBeDisabled();
    });

    // Mobile state should be "plusd" — StartHereCard shows "PLUSD Balance" eyebrow.
    await waitFor(() => {
      const elements = screen.getAllByText("PLUSD Balance");
      expect(elements.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("Case 2: has sPLUSD — Total Balance includes sPLUSD-to-PLUSD, mobile state splusd, RecentActivityCard present", async () => {
    // Seed 100 sPLUSD at 7-decimal scale: 100 * 10^7 = 1_000_000_000n
    localStorage.setItem(
      "pipeline.mock.wallet.stellar.stakedPlusd.shareBalance",
      "1000000000",
    );
    // Rate: 1.04 PLUSD per sPLUSD → "10400000" (SAC 1e7 scale)
    localStorage.setItem(
      "pipeline.mock.wallet.stellar.stakedPlusd.convertToAssets",
      "10400000",
    );
    // Also seed some PLUSD.
    localStorage.setItem(
      "pipeline.mock.wallet.stellar.balance.sac.plusd",
      "1000000000",
    );

    renderHomeStellar();

    // Mobile state "splusd" → StakeCard shows "Staked PLUSD" label.
    await waitFor(() => {
      const elements = screen.getAllByText("Staked PLUSD");
      expect(elements.length).toBeGreaterThanOrEqual(1);
    });

    // Mobile RecentActivityCard should be present (State C).
    await waitFor(() => {
      const cards = screen.getAllByRole("region", { name: "Recent activity" });
      // Both mobile and desktop blocks render the card.
      expect(cards.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("Case 3: zero balances / no trustline — $0.00 Total Balance, Stake disabled, mobile state empty", async () => {
    // No balance keys seeded → all balances undefined → State A.

    renderHomeStellar();

    // Total Balance should be $0.00.
    await waitFor(() => {
      const zeroHeadings = screen.getAllByRole("heading", { name: "$0.00" });
      expect(zeroHeadings.length).toBeGreaterThanOrEqual(1);
    });

    // Stake CTA should be disabled (no PLUSD).
    await waitFor(() => {
      const nothingBtn = screen.getByRole("button", {
        name: "Nothing to Stake",
      });
      expect(nothingBtn).toBeDisabled();
    });

    // Mobile state "empty" → StartHereCard shows "Start here" / "Get PLUSD" (not PLUSD Balance).
    await waitFor(() => {
      expect(screen.queryByText("PLUSD Balance")).not.toBeInTheDocument();
    });
  });

  it("Case 4: decimal-scale assertion — 7-decimal PLUSD is formatted as $1,234.57, not mis-scaled", async () => {
    // Seed 1234.5678900 PLUSD at 7-decimal fixed-point.
    // 1234.5678900 * 10^7 = 12_345_678_900n
    localStorage.setItem(
      "pipeline.mock.wallet.stellar.balance.sac.plusd",
      "12345678900",
    );

    renderHomeStellar();

    // The Total Balance heading must show "$1,234.57" — not a mis-scaled value.
    // If the 18-decimal path were used by mistake, 12_345_678_900n at 18 decimals
    // would render as "$0.00" (value ~1.23e-8), proving the 7-decimal path is taken.
    await waitFor(() => {
      // We look for a heading with "$1,234.57" (Total Balance, mobile block).
      const headings = screen.getAllByRole("heading");
      const balanceHeading = headings.find(
        (h) => h.textContent === "$1,234.57",
      );
      expect(balanceHeading).not.toBeUndefined();
    });
  });

  it("Case 5 (EVM regression): existing EVM connected tests still pass", async () => {
    // Guard: switch back to EVM view; seed EVM connected state.
    // Use renderHome() — that defaults to EVM view (no WalletViewProvider override).
    localStorage.clear();
    localStorage.setItem("pipeline.mock.wallet.isConnected", "true");
    localStorage.setItem("pipeline.mock.wallet.address", WALLET_ADDRESS);

    renderHome();

    await waitFor(() => {
      const elements = screen.getAllByText("Total Balance");
      expect(elements.length).toBeGreaterThanOrEqual(1);
    });
    // $0.00 because no EVM PLUSD balance seeded.
    await waitFor(() => {
      const zeroHeadings = screen.getAllByRole("heading", { name: "$0.00" });
      expect(zeroHeadings.length).toBeGreaterThanOrEqual(1);
    });
  });
});
