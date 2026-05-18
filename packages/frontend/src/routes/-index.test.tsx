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
import { WalletProvider } from "@/wallet/WalletProvider";
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

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...original,
    useNavigate: vi.fn(() => vi.fn()),
    useRouterState: vi.fn(() => "/"),
    createFileRoute: original.createFileRoute,
    Link: ({
      children,
      to,
    }: {
      children: React.ReactNode;
      to: string;
    }) => <a href={to}>{children}</a>,
  };
});

// ── ENV mock ──────────────────────────────────────────────────────────────────

const mockEnv = vi.hoisted(() => ({
  EVM_CHAIN_ID: 560048,
  EVM_RPC_URL: "https://ethereum-hoodi-rpc.publicnode.com",
  DEPOSIT_MANAGER_ADDRESS:
    "0x3333000000000000000000000000000000000003" as `0x${string}`,
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
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const WALLET_ADDRESS = "0x1234000000000000000000000000000000000001";

function renderHome() {
  const HomePage = Route.options.component as React.ComponentType;
  return render(
    <WalletProvider>
      <HomePage />
    </WalletProvider>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Home page — disconnected state", () => {
  beforeEach(() => {
    localStorage.clear();
    mockOpen.mockClear();
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
      expect(
        screen.getByRole("heading", { name: "Connect Wallet" }),
      ).toBeInTheDocument();
    });
  });

  it("PortfolioPlaceholderCard is absent", async () => {
    renderHome();
    await waitFor(() => {
      expect(screen.queryByText("Total Balance")).not.toBeInTheDocument();
    });
  });

  it("clicking Connect calls useWallet().connect() → opens AppKit modal", async () => {
    const user = userEvent.setup();
    renderHome();

    const connectBtn = await screen.findByRole("button", { name: "Connect" });
    await user.click(connectBtn);

    // useWallet().connect() delegates to useAppKit().open()
    await waitFor(() => {
      expect(mockOpen).toHaveBeenCalledTimes(1);
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
    renderHome();
    await waitFor(() => {
      expect(screen.getByText("Total Balance")).toBeInTheDocument();
    });
  });

  it("shows '$0.00' balance literal", async () => {
    renderHome();
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "$0.00" })).toBeInTheDocument();
    });
  });

  it("'Get PLUSD to start' link is present and points to /deposit", async () => {
    renderHome();
    const link = await screen.findByRole("link", { name: "Get PLUSD to start" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/deposit");
  });

  it("ConnectWalletPromoCard is absent", async () => {
    renderHome();
    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: "Connect Wallet" }),
      ).not.toBeInTheDocument();
    });
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
    renderHome();
    const tab7d = await screen.findByRole("tab", { name: "7D" });
    expect(tab7d).toHaveAttribute("aria-selected", "true");
  });

  it("other tabs default to inactive", async () => {
    renderHome();
    const tab1m = await screen.findByRole("tab", { name: "1M" });
    expect(tab1m).toHaveAttribute("aria-selected", "false");
  });

  it("clicking '1M' makes it the active tab and deactivates '7D'", async () => {
    const user = userEvent.setup();
    renderHome();

    const tab1m = await screen.findByRole("tab", { name: "1M" });
    await user.click(tab1m);

    await waitFor(() => {
      expect(tab1m).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("tab", { name: "7D" })).toHaveAttribute(
        "aria-selected",
        "false",
      );
    });
  });

  it("switching tabs does not call useAppKit().open (no navigation triggered)", async () => {
    const user = userEvent.setup();
    renderHome();

    const tab3m = await screen.findByRole("tab", { name: "3M" });
    await user.click(tab3m);

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
    renderHome();

    await waitFor(() => {
      const card = screen.getByRole("region", { name: "Connect Wallet" });
      expect(card.className).toContain("min-h-[274px]");
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
      const card = screen.getByRole("region", { name: "$0.00" });
      expect(card.className).toContain("min-h-[274px]");
    });
  });
});
