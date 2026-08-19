/**
 * Integration tests for the / (home) route — wallet state seeded via the
 * `pipeline.mock.wallet.*` localStorage mock layer; no real wagmi/kit calls.
 * spec: docs/frontend/dashboard-components.md#home-route
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React, { useEffect } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EvmWalletProvider } from "@/wallet/evm/EvmWalletProvider";
import { WalletViewProvider, useWalletView } from "@/wallet";
import { Route } from "./index";

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

const mockConnectModalOpen = vi.fn();
vi.mock("@/wallet", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/wallet")>()),
  useConnectModal: () => ({ open: mockConnectModalOpen, close: vi.fn() }),
}));

const mockPnlData = vi.hoisted(() => ({
  current: undefined as
    | {
        total_unrealized_pnl: string;
        total_pnl?: string;
        avg_apy?: string | null;
      }
    | undefined,
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

const mockEnv = vi.hoisted(() => ({
  EVM_CHAIN_ID: 560048,
  STELLAR_CHAIN_ID: 99000001,
  EVM_RPC_URL: "https://ethereum-hoodi-rpc.publicnode.com",
  DEPOSIT_MANAGER_ADDRESS:
    "0x3333000000000000000000000000000000000003" as `0x${string}`,
  STAKED_PLUSD_ADDRESS:
    "0x0000000000000000000000000000000000000000" as `0x${string}`,
  STELLAR_STAKED_PLUSD_ID: "",
  WALLETCONNECT_PROJECT_ID: "replace-me",
}));

vi.mock("@/lib/env", () => ({
  ENV: mockEnv,
}));

vi.mock("@/api", () => ({
  useRequests: () => ({ data: undefined, isLoading: false, error: null }),
  useStats: () => ({ data: undefined, isLoading: false, error: null }),
  usePnl: () => ({
    data: mockPnlData.current,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useStatsPrices: () => ({
    data: undefined,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  formatApy: (apy: string | null | undefined) => {
    if (apy == null) return "—";
    const num = Number(apy);
    return Number.isFinite(num) ? `${(num * 100).toFixed(2)}%` : "—";
  },
}));

const WALLET_ADDRESS = "0x1234000000000000000000000000000000000001";

function renderHome() {
  const HomePage = Route.options.component as React.ComponentType;
  return render(
    <EvmWalletProvider>
      <HomePage />
    </EvmWalletProvider>,
  );
}

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

beforeEach(() => {
  mockPnlData.current = undefined;
});

describe("Home page — disconnected state", () => {
  beforeEach(() => {
    localStorage.clear();
    mockOpen.mockClear();
    mockConnectModalOpen.mockClear();
    mockNavigate.mockClear();
    mockPnlData.current = undefined;
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("renders without throwing", () => {
    expect(() => renderHome()).not.toThrow();
  });

  it("shows ConnectWalletPromoCard heading", async () => {
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

    const connectBtns = await screen.findAllByRole("button", {
      name: "Connect",
    });
    await user.click(connectBtns[0]!);

    await waitFor(() => {
      expect(mockConnectModalOpen).toHaveBeenCalledTimes(1);
    });
  });

  it("clicking Buy navigates to /deposit with direction=deposit", async () => {
    const user = userEvent.setup();
    renderHome();

    const buyBtns = await screen.findAllByRole("button", { name: "Buy" });
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

    const sellBtns = await screen.findAllByRole("button", { name: "Sell" });
    expect(sellBtns.length).toBeGreaterThanOrEqual(2);
    expect(sellBtns[0]).toBeDisabled();
    expect(sellBtns[1]).not.toBeDisabled();
    await user.click(sellBtns[1]!);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/deposit",
        search: { direction: "withdraw" },
      });
    });
  });

  it("Stake button is enabled when wallet is disconnected (regardless of PLUSD balance)", async () => {
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

    const stakeBtns = await screen.findAllByRole("button", {
      name: "Stake PLUSD",
    });
    await user.click(stakeBtns[0]!);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/stake",
        search: { tab: "stake" },
      });
    });
  });

  it("clicking Stake navigates to /stake when wallet has PLUSD balance", async () => {
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

    const stakeBtns = await screen.findAllByRole("button", {
      name: "Stake PLUSD",
    });
    expect(stakeBtns[0]).not.toBeDisabled();
    await user.click(stakeBtns[0]!);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/stake",
        search: { tab: "stake" },
      });
    });
  });
});

describe("Home page — connected state (mock)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockOpen.mockClear();
    localStorage.setItem("pipeline.mock.wallet.isConnected", "true");
    localStorage.setItem("pipeline.mock.wallet.address", WALLET_ADDRESS);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("shows PortfolioPlaceholderCard — 'Total Balance' heading", async () => {
    renderHome();
    await waitFor(() => {
      const elements = screen.getAllByText("Total Balance");
      expect(elements.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows '$0.00' sPLUSD balance literal", async () => {
    renderHome();
    await waitFor(() => {
      const headings = screen.getAllByRole("heading", {
        name: "$0.00",
      });
      expect(headings.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("'Get PLUSD to start' link is present and points to /deposit", async () => {
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

  it("Stake button is disabled, grey, and labelled 'Nothing to Stake' when connected with zero PLUSD balance", async () => {
    renderHome();

    const stakeBtns = await screen.findAllByRole("button", {
      name: "Nothing to Stake",
    });
    expect(stakeBtns.length).toBeGreaterThanOrEqual(1);
    for (const btn of stakeBtns) {
      expect(btn).toBeDisabled();
      expect(btn.className).toContain("disabled:bg-[rgba(184,191,190,0.12)]");
      expect(btn.className).toContain(
        "disabled:text-[color:var(--color-pipeline-ink-subtle)]",
      );
    }
    expect(
      screen.queryByRole("button", { name: "Stake PLUSD" }),
    ).not.toBeInTheDocument();
  });
});

describe("Home page — Total Balance zero-placeholder chart (#1114)", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("pipeline.mock.wallet.isConnected", "true");
    localStorage.setItem("pipeline.mock.wallet.address", WALLET_ADDRESS);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("renders the zero-value placeholder chart with period tabs, no fabricated values", async () => {
    renderHome();
    await waitFor(() => {
      expect(
        screen.getAllByRole("tab", { name: "All" }).length,
      ).toBeGreaterThanOrEqual(1);
    });
    const tooltips = screen.getAllByTestId("chart-tooltip");
    expect(tooltips.length).toBeGreaterThanOrEqual(1);
    expect(tooltips[0]).toHaveAttribute("aria-hidden", "true");
    expect(document.querySelectorAll("[data-bar-slot]").length % 100).toBe(0);
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
    renderHome();

    await waitFor(() => {
      const cards = screen.getAllByRole("region", { name: "$0.00" });
      expect(cards.some((c) => c.className.includes("min-h-[274px]"))).toBe(
        true,
      );
    });
  });
});

const PLUSD_ADDRESS = "0xaaaa000000000000000000000000000000000002";
const STAKED_PLUSD_ADDRESS = "0x0000000000000000000000000000000000000000";

describe("Home page — mobile State A: connected, 0 PLUSD, 0 sPLUSD", () => {
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
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("greeting shows 'Welcome back' text on mobile", async () => {
    renderHome();
    await waitFor(() => {
      expect(screen.getByText("Welcome back")).toBeInTheDocument();
    });
  });

  it("mobile StakeCard shows 'Nothing to Stake' button (State A)", async () => {
    renderHome();
    await waitFor(() => {
      expect(
        screen.getAllByRole("button", { name: "Nothing to Stake" }).length,
      ).toBeGreaterThanOrEqual(1);
    });
  });

  it("mobile StakeCard 'Nothing to Stake' button is disabled (State A)", async () => {
    renderHome();
    await waitFor(() => {
      for (const btn of screen.getAllByRole("button", {
        name: "Nothing to Stake",
      })) {
        expect(btn).toBeDisabled();
      }
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
    renderHome();
    await waitFor(() => {
      const cards = screen.getAllByRole("region", {
        name: "Recent activity",
      });
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
    localStorage.setItem(
      `pipeline.mock.wallet.balance.${PLUSD_ADDRESS}`,
      "1000000000000000000000",
    );
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
    renderHome();

    await waitFor(() => {
      const stakeBtns = screen.getAllByRole("button", { name: "Stake PLUSD" });
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
    renderHome();
    await waitFor(() => {
      const cards = screen.getAllByRole("region", { name: "Recent activity" });
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
    localStorage.setItem(
      `pipeline.mock.wallet.balance.${PLUSD_ADDRESS}`,
      "1000000000000000000000",
    );
    localStorage.setItem(
      `pipeline.mock.wallet.balance.${SPLUSD_ADDRESS}`,
      "1000000000000000000000",
    );
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

  it("StakeCard shows 'Stake More' CTA (State C)", async () => {
    renderHome();
    await waitFor(() => {
      expect(
        screen.getAllByRole("button", { name: "Stake More PLUSD" }).length,
      ).toBeGreaterThanOrEqual(1);
    });
  });

  it("StakeCard shows 'Unstake' link (State C)", async () => {
    renderHome();
    await waitFor(() => {
      expect(
        screen.getAllByTestId("unstake-link").length,
      ).toBeGreaterThanOrEqual(1);
    });
  });

  it("clicking 'Unstake' navigates to /stake?tab=unstake (State C)", async () => {
    const user = userEvent.setup();
    renderHome();

    const links = await screen.findAllByTestId("unstake-link");
    await user.click(links[0]!);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/stake",
        search: { tab: "unstake" },
      });
    });
  });

  it("EarnedCard shows tracking placeholder when State C has no PnL yet", async () => {
    renderHome();
    await waitFor(() => {
      const elements = screen.getAllByText("Tracked once you stake");
      expect(elements.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("EarnedCard shows total PnL in dollars from the pnl API when available", async () => {
    mockPnlData.current = {
      total_unrealized_pnl: "42800000000000000000",
      total_pnl: "123000000000000000000", // 123 PLUSD at 18 dp
      avg_apy: "0.0842",
    };

    renderHome();

    await waitFor(() => {
      const elements = screen.getAllByText("+$123.00");
      expect(elements.length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryByText("8.42% p.a.")).not.toBeInTheDocument();
  });

  it("mobile portfolio chart summary shows sPLUSD balance in currency format and unrealized PnL below it", async () => {
    mockPnlData.current = {
      total_unrealized_pnl: "42800000000000000000",
      avg_apy: "0.0842",
    };

    renderHome();

    await waitFor(() => {
      expect(
        screen.getAllByRole("heading", { name: "$1,000.00" })[0],
      ).toBeInTheDocument();
      expect(screen.getAllByTestId("earning-caption")[0]).toHaveTextContent(
        "+$42.80 unrealized",
      );
      expect(
        screen.queryByTestId("splusd-balance-caption"),
      ).not.toBeInTheDocument();
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
      const sharesEls = screen.getAllByTestId("splusd-shares");
      expect(sharesEls.length).toBeGreaterThanOrEqual(1);
      expect(sharesEls[0]?.textContent).toContain("1,000.00");
    });
  });

  it("StakeCard staked sub-line shows the sPLUSD label, USD value and coin icon (State C)", async () => {
    renderHome();
    await waitFor(() => {
      const subLine = screen.getAllByTestId("splusd-in-plusd")[0];
      expect(subLine?.textContent).toContain("sPLUSD");
      expect(subLine?.textContent).toMatch(/· \$[\d,]+\.\d{2}/);
      expect(subLine?.querySelector("img")).toBeInTheDocument();
    });
  });

  it("desktop StakeCard renders the staked state, not the marketing CTA (State C)", async () => {
    renderHome();
    await waitFor(() => {
      expect(screen.queryByTestId("home-stake-button")).not.toBeInTheDocument();
      expect(
        screen.getAllByTestId("home-stake-more-button").length,
      ).toBeGreaterThanOrEqual(2);
    });
  });
});

const STELLAR_MOCK_ADDRESS =
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

describe("Home page — Stellar-only connected (regression #684)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockOpen.mockClear();
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
    renderHomeStellar();
    await waitFor(() => {
      const portfolioCards = screen.getAllByTestId(
        "home-portfolio-placeholder",
      );
      expect(portfolioCards.length).toBeGreaterThanOrEqual(1);
    });
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
    localStorage.setItem("pipeline.mock.wallet.isConnected", "true");
    localStorage.setItem("pipeline.mock.wallet.address", WALLET_ADDRESS);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("shows disconnected promo card when Stellar view active but Stellar not connected", async () => {
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

describe("Home page — Stellar connected balances (#688)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockOpen.mockClear();
    mockNavigate.mockClear();
    localStorage.setItem(
      "pipeline.mock.wallet.stellar.address",
      STELLAR_MOCK_ADDRESS,
    );
    localStorage.setItem("pipeline.mock.wallet.stellar.isConnected", "true");
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("Case 1: has PLUSD, 0 sPLUSD — Total Balance shows sPLUSD only, Stake enabled, mobile state plusd", async () => {
    localStorage.setItem(
      "pipeline.mock.wallet.stellar.balance.sac.plusd",
      "5000000000",
    );

    renderHomeStellar();

    await waitFor(() => {
      const headings = screen.getAllByRole("heading", {
        name: "$0.00",
      });
      expect(headings.length).toBeGreaterThanOrEqual(1);
      expect(
        screen.queryByTestId("splusd-balance-caption"),
      ).not.toBeInTheDocument();
    });

    await waitFor(() => {
      const subLine = screen.getByTestId("plusd-in-usdc");
      expect(subLine).toHaveTextContent(/\$500\.00 USDC/);
    });

    await waitFor(() => {
      const stakeBtns = screen.getAllByRole("button", { name: "Stake PLUSD" });
      expect(stakeBtns.length).toBeGreaterThanOrEqual(1);
      expect(stakeBtns[0]).not.toBeDisabled();
    });

    await waitFor(() => {
      const elements = screen.getAllByText("PLUSD Balance");
      expect(elements.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("Case 2: has sPLUSD — Total Balance shows sPLUSD shares in currency format, mobile state splusd, RecentActivityCard present", async () => {
    localStorage.setItem(
      "pipeline.mock.wallet.stellar.stakedPlusd.shareBalance",
      "1000000000",
    );
    localStorage.setItem(
      "pipeline.mock.wallet.stellar.stakedPlusd.convertToAssets",
      "10400000",
    );
    localStorage.setItem(
      "pipeline.mock.wallet.stellar.balance.sac.plusd",
      "1000000000",
    );

    renderHomeStellar();

    await waitFor(() => {
      const elements = screen.getAllByText("Staked PLUSD");
      expect(elements.length).toBeGreaterThanOrEqual(1);
    });

    await waitFor(() => {
      const headings = screen.getAllByRole("heading", {
        name: "$100.00",
      });
      expect(headings.length).toBeGreaterThanOrEqual(1);
    });

    await waitFor(() => {
      const subLine = screen.getAllByTestId("splusd-in-plusd")[0];
      expect(subLine?.textContent).toContain("104.00 sPLUSD · $100.00");
      expect(subLine?.querySelector("img")).toBeInTheDocument();
    });

    await waitFor(() => {
      const cards = screen.getAllByRole("region", { name: "Recent activity" });
      expect(cards.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("Case 3: zero balances / no trustline — $0.00 sPLUSD Total Balance, Stake disabled, mobile state empty", async () => {
    renderHomeStellar();

    await waitFor(() => {
      const zeroHeadings = screen.getAllByRole("heading", {
        name: "$0.00",
      });
      expect(zeroHeadings.length).toBeGreaterThanOrEqual(1);
    });

    await waitFor(() => {
      for (const nothingBtn of screen.getAllByRole("button", {
        name: "Nothing to Stake",
      })) {
        expect(nothingBtn).toBeDisabled();
      }
    });

    await waitFor(() => {
      expect(screen.queryByText("PLUSD Balance")).not.toBeInTheDocument();
    });
  });

  it("Case 4: decimal-scale assertion — 7-decimal PLUSD StartHere balance is formatted as $1,234.57, not mis-scaled", async () => {
    localStorage.setItem(
      "pipeline.mock.wallet.stellar.balance.sac.plusd",
      "12345678900",
    );

    renderHomeStellar();

    await waitFor(() => {
      const subLine = screen.getByTestId("plusd-in-usdc");
      expect(subLine).toHaveTextContent("$1,234.57 USDC");
    });
  });

  it("Case 5 (EVM regression): existing EVM connected tests still pass", async () => {
    localStorage.clear();
    localStorage.setItem("pipeline.mock.wallet.isConnected", "true");
    localStorage.setItem("pipeline.mock.wallet.address", WALLET_ADDRESS);

    renderHome();

    await waitFor(() => {
      const elements = screen.getAllByText("Total Balance");
      expect(elements.length).toBeGreaterThanOrEqual(1);
    });
    await waitFor(() => {
      const zeroHeadings = screen.getAllByRole("heading", {
        name: "$0.00",
      });
      expect(zeroHeadings.length).toBeGreaterThanOrEqual(1);
    });
  });
});
