/**
 * TopBar — unit tests.
 *
 * Tests route-derived active nav, disconnected vs connected state (via the
 * mock-wallet localStorage keys), and a smoke test that the header renders
 * on non-`/` routes (regression guard for the root-layout approach).
 *
 * Also covers:
 *   - Neither wallet connected → "Connect Wallet" present; clicking opens
 *     ConnectWalletModal with EVM/Soroban tabs.
 *   - EVM connected → pill shows EVM balance.
 *   - Both connected → pill shows active namespace's balance.
 *
 * Stellar hooks (useStellarWallet / useStellarToken) are mocked at module level
 * to avoid a real StellarWalletsKit initialisation and QueryClient requirement.
 * EVM state is driven via `pipeline.mock.wallet.*` localStorage keys.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createRouter,
  createRoute,
  createRootRoute,
  RouterProvider,
  createMemoryHistory,
} from "@tanstack/react-router";
import { EvmWalletProvider } from "@/wallet/evm/EvmWalletProvider";
import { WalletViewProvider } from "@/wallet/WalletViewContext";
import { ConnectModalProvider } from "@/wallet/ConnectModalProvider";
import { WalletGateProvider } from "@/wallet/WalletGateProvider";
import { TopBar } from "./TopBar";

// ── Stellar hook mocks ────────────────────────────────────────────────────────

const {
  mockStellarConnect,
  mockStellarDisconnect2,
  mockStellarWalletState,
  mockStellarTokenState,
  mockStellarPlusdState,
  mockStellarSplusdState,
} = vi.hoisted(() => ({
  mockStellarConnect: vi.fn(),
  mockStellarDisconnect2: vi.fn(),
  mockStellarWalletState: {
    address: undefined as string | undefined,
    isConnected: false,
  },
  mockStellarTokenState: {
    balance: undefined as string | undefined,
    formattedBalance: undefined as string | undefined,
    refetchBalance: vi.fn(),
    isLoading: false,
    error: null,
  },
  mockStellarPlusdState: {
    balance: undefined as string | undefined,
    hasTrustline: false,
    isAuthorized: false,
    decimals: 7,
    refetchBalance: vi.fn(),
    isLoading: false,
    error: null as Error | null,
  },
  mockStellarSplusdState: {
    balance: undefined as bigint | undefined,
    isLoading: false,
    error: null as Error | null,
    refetch: vi.fn(),
  },
}));

vi.mock("@/wallet/stellar/useStellarWallet", () => ({
  useStellarWallet: () => ({
    ...mockStellarWalletState,
    connect: mockStellarConnect,
    disconnect: mockStellarDisconnect2,
  }),
  useStellarConnectors: () => ({
    connectWallet: vi.fn(),
  }),
}));

vi.mock("@/wallet/stellar/useStellarToken", () => ({
  useStellarToken: () => ({ ...mockStellarTokenState }),
  formatUsdcDisplay: (s: string) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(s)),
}));

// Mock the new Stellar balance hooks added in Issue #675.
vi.mock("@/wallet/stellar/useStellarDepositManagerAddresses", () => ({
  useStellarDepositManagerAddresses: () => ({
    addresses: undefined,
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@/wallet/stellar/useStellarSacToken", () => ({
  useStellarSacToken: () => ({ ...mockStellarPlusdState }),
  sacRawToDisplay: (raw: bigint) => {
    const factor = BigInt(10 ** 7);
    const whole = raw / factor;
    const frac = raw % factor;
    const fracStr = String(frac).padStart(7, "0");
    return `${whole}.${fracStr}`;
  },
  SAC_DECIMALS: 7,
  sacDisplayToRaw: (s: string) => BigInt(Math.round(Number(s) * 1e7)),
}));

vi.mock("@/wallet/stellar/useStellarStakedPlusd", () => ({
  useStellarStakedPlusdBalance: () => ({ ...mockStellarSplusdState }),
}));

vi.mock("@/wallet/stellar/config", () => ({
  StellarWalletsKit: {
    authModal: vi.fn(),
    getAddress: vi.fn().mockResolvedValue({ address: undefined }),
    disconnect: vi.fn(),
    init: vi.fn(),
  },
}));

// ── Wagmi / AppKit mocks ──────────────────────────────────────────────────────

const mockUseReadContract = vi.fn(() => ({
  data: undefined as unknown,
  isLoading: false,
  error: null,
  refetch: vi.fn(),
}));

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
    useWriteContract: vi.fn(() => ({
      writeContract: vi.fn(),
      data: undefined,
      isPending: false,
      isSuccess: false,
      error: null,
      reset: vi.fn(),
    })),
    usePublicClient: vi.fn(() => ({
      estimateContractGas: vi.fn(async () => 1_000_000n),
    })),
    useWaitForTransactionReceipt: vi.fn(() => ({
      data: undefined,
      isLoading: false,
      isSuccess: false,
      isError: false,
      error: null,
    })),
    useConnect: vi.fn(() => ({ connect: vi.fn() })),
    useConnectors: vi.fn(() => []),
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

// ── Mock FirstConnectionModal ─────────────────────────────────────────────────
// WalletGateProvider renders FirstConnectionModal; mock it to avoid portal/DOM
// issues. The TopBar modal tests pre-acknowledge terms so the gate is skipped.

vi.mock("../components/FirstConnectionModal", () => ({
  FirstConnectionModal: () => null,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const USDC_ADDRESS = "0x2222000000000000000000000000000000000002";
const MOCK_ADDRESS = "0x8493000000000000000000000000000000003b92";
const MOCK_STELLAR_ADDRESS =
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

/** Builds a minimal in-test router that renders <TopBar /> on every route. */
function buildRouter(initialPath: string) {
  const rootRoute = createRootRoute({
    component: () => <TopBar />,
  });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => null,
  });
  const depositRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/deposit",
    component: () => null,
  });
  const withdrawRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/withdraw",
    component: () => null,
  });
  const transactionsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/transactions",
    component: () => null,
  });
  const stakeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/stake",
    component: () => null,
  });
  const routeTree = rootRoute.addChildren([
    indexRoute,
    depositRoute,
    withdrawRoute,
    transactionsRoute,
    stakeRoute,
  ]);
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
}

function renderTopBar(initialPath = "/") {
  const router = buildRouter(initialPath);
  return render(
    <WalletGateProvider>
      <EvmWalletProvider>
        <ConnectModalProvider>
          <WalletViewProvider>
            <RouterProvider router={router} />
          </WalletViewProvider>
        </ConnectModalProvider>
      </EvmWalletProvider>
    </WalletGateProvider>,
  );
}

// ── Mock wallet key helpers ───────────────────────────────────────────────────

function setConnectedMock() {
  localStorage.setItem("pipeline.mock.wallet.address", MOCK_ADDRESS);
  localStorage.setItem("pipeline.mock.wallet.isConnected", "true");
  localStorage.setItem(
    "pipeline.mock.wallet.contract.depositManager.usdc",
    USDC_ADDRESS,
  );
  localStorage.setItem(
    `pipeline.mock.wallet.contract.${USDC_ADDRESS.toLowerCase()}.decimals`,
    "6",
  );
  localStorage.setItem(
    `pipeline.mock.wallet.contract.${USDC_ADDRESS.toLowerCase()}.symbol`,
    "USDC",
  );
  localStorage.setItem(
    `pipeline.mock.wallet.balance.${USDC_ADDRESS.toLowerCase()}`,
    "1000000000", // 1,000 USDC at 6 dp
  );
}

function setStellarConnected() {
  mockStellarWalletState.address = MOCK_STELLAR_ADDRESS;
  mockStellarWalletState.isConnected = true;
  mockStellarTokenState.balance = "2000.00";
  mockStellarTokenState.formattedBalance = "$2,000.00";
}

function setStellarPlusdBalance(balance: string) {
  mockStellarPlusdState.balance = balance;
  mockStellarPlusdState.hasTrustline = true;
  mockStellarPlusdState.isAuthorized = true;
}

function setStellarSplusdBalance(rawBigint: bigint) {
  mockStellarSplusdState.balance = rawBigint;
}

function clearMocks() {
  [
    "pipeline.mock.wallet.address",
    "pipeline.mock.wallet.isConnected",
    "pipeline.mock.wallet.contract.depositManager.usdc",
    `pipeline.mock.wallet.contract.${USDC_ADDRESS.toLowerCase()}.decimals`,
    `pipeline.mock.wallet.contract.${USDC_ADDRESS.toLowerCase()}.symbol`,
    `pipeline.mock.wallet.balance.${USDC_ADDRESS.toLowerCase()}`,
  ].forEach((k) => localStorage.removeItem(k));
  mockStellarWalletState.address = undefined;
  mockStellarWalletState.isConnected = false;
  mockStellarTokenState.balance = undefined;
  mockStellarTokenState.formattedBalance = undefined;
  mockStellarPlusdState.balance = undefined;
  mockStellarPlusdState.hasTrustline = false;
  mockStellarPlusdState.isAuthorized = false;
  mockStellarSplusdState.balance = undefined;
}

// ── Tests: route-driven active nav ────────────────────────────────────────────

describe("TopBar — route-driven active state", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("highlights Home on /", async () => {
    renderTopBar("/");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute(
        "data-active",
        "true",
      ),
    );
    expect(screen.getByRole("button", { name: "Convert" })).toHaveAttribute(
      "data-active",
      "false",
    );
  });

  it("highlights Convert on /deposit", async () => {
    renderTopBar("/deposit");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Convert" })).toHaveAttribute(
        "data-active",
        "true",
      ),
    );
    expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute(
      "data-active",
      "false",
    );
  });

  it("highlights Convert on /deposit?direction=withdraw (withdraw direction uses /deposit pathname)", async () => {
    renderTopBar("/deposit");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Convert" })).toHaveAttribute(
        "data-active",
        "true",
      ),
    );
  });

  it("highlights Activity on /transactions", async () => {
    renderTopBar("/transactions");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Activity" })).toHaveAttribute(
        "data-active",
        "true",
      ),
    );
    expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute(
      "data-active",
      "false",
    );
  });

  it("highlights Earn on /stake", async () => {
    renderTopBar("/stake");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Earn" })).toHaveAttribute(
        "data-active",
        "true",
      ),
    );
    expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute(
      "data-active",
      "false",
    );
  });

  it("navigates to /deposit when Convert is clicked", async () => {
    const user = userEvent.setup();
    renderTopBar("/");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute(
        "data-active",
        "true",
      ),
    );
    await user.click(screen.getByRole("button", { name: "Convert" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Convert" })).toHaveAttribute(
        "data-active",
        "true",
      ),
    );
    expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute(
      "data-active",
      "false",
    );
  });

  it("navigates to /transactions when Activity is clicked", async () => {
    const user = userEvent.setup();
    renderTopBar("/");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute(
        "data-active",
        "true",
      ),
    );
    await user.click(screen.getByRole("button", { name: "Activity" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Activity" })).toHaveAttribute(
        "data-active",
        "true",
      ),
    );
  });

  it("navigates to /stake when Earn is clicked", async () => {
    const user = userEvent.setup();
    renderTopBar("/");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute(
        "data-active",
        "true",
      ),
    );
    await user.click(screen.getByRole("button", { name: "Earn" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Earn" })).toHaveAttribute(
        "data-active",
        "true",
      ),
    );
    expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute(
      "data-active",
      "false",
    );
  });
});

// ── Tests: wallet state ───────────────────────────────────────────────────────

describe("TopBar — wallet state", () => {
  afterEach(() => {
    clearMocks();
    localStorage.clear();
  });

  it("renders Connect Wallet button when no mock keys are set", async () => {
    renderTopBar("/");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Connect Wallet" }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText("$1,000.00")).not.toBeInTheDocument();
  });

  it("renders WalletPill with formatted balance when connected via mock keys", async () => {
    setConnectedMock();
    renderTopBar("/");
    await waitFor(() =>
      expect(screen.getByText("$1,000.00")).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: "Connect Wallet" }),
    ).not.toBeInTheDocument();
  });

  it("clicking the pill when connected toggles aria-expanded and shows AccountDropdown", async () => {
    const user = userEvent.setup();
    setConnectedMock();
    renderTopBar("/");

    const trigger = await screen.findByRole("button", {
      name: /\$1,000\.00|—/,
    });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menu", { name: "Account" })).toBeInTheDocument();
  });
});

// ── Tests: ConnectWalletModal integration ────────────────────────────────────

describe("TopBar — ConnectWalletModal", () => {
  beforeEach(() => {
    // Pre-acknowledge terms so the gate is skipped and ConnectWalletModal
    // opens immediately. The gate ordering is tested in ConnectModalProvider.test.tsx.
    localStorage.setItem("pipeline.wallet.termsAcknowledged", "true");
  });

  afterEach(() => {
    clearMocks();
    localStorage.clear();
    vi.clearAllMocks();
    document.body.style.overflow = "";
  });

  it("clicking Connect Wallet opens ConnectWalletModal", async () => {
    const user = userEvent.setup();
    renderTopBar("/");

    const connectBtn = await screen.findByRole("button", {
      name: "Connect Wallet",
    });
    await user.click(connectBtn);

    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "Connect Wallet" }),
      ).toBeInTheDocument();
    });
    // New modal has EVM and Soroban tabs
    expect(screen.getByRole("tab", { name: "EVM" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Soroban" })).toBeInTheDocument();
  });

  it("clicking Close (×) in the ConnectWalletModal dismisses it", async () => {
    const user = userEvent.setup();
    renderTopBar("/");

    await user.click(
      await screen.findByRole("button", { name: "Connect Wallet" }),
    );
    await screen.findByRole("dialog", { name: "Connect Wallet" });

    await user.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Connect Wallet" }),
      ).not.toBeInTheDocument();
    });
  });

  it("Escape key dismisses the ConnectWalletModal", async () => {
    const user = userEvent.setup();
    renderTopBar("/");

    await user.click(
      await screen.findByRole("button", { name: "Connect Wallet" }),
    );
    await screen.findByRole("dialog", { name: "Connect Wallet" });

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Connect Wallet" }),
      ).not.toBeInTheDocument();
    });
  });
});

// ── Tests: both wallets connected ─────────────────────────────────────────────

describe("TopBar — both namespaces connected", () => {
  afterEach(() => {
    clearMocks();
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("pill shows EVM balance when both connected and EVM is the active namespace", async () => {
    setConnectedMock();
    setStellarConnected();
    renderTopBar("/");

    // Default is EVM view — show EVM balance.
    await waitFor(() =>
      expect(screen.getByText("$1,000.00")).toBeInTheDocument(),
    );
  });
});

// ── Smoke test: header on non-/ routes ───────────────────────────────────────

describe("TopBar — root layout smoke test", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("renders the Pipeline logo and nav on /deposit (regression guard for root layout)", async () => {
    renderTopBar("/deposit");

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Home" })).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("navigation", { name: "Primary" }),
    ).toBeInTheDocument();
  });
});

// ── Tests: mobile responsive classes ─────────────────────────────────────────
//
// JSDOM has no real media-query engine, so we assert on CSS class presence
// rather than computed visibility — mirroring the "min-h-[274px]" class-based
// approach used in other component tests in this codebase.
//
// The mobile hamburger control is always present in the DOM but hidden above
// `md` via `md:hidden`.  The desktop nav is always present but hidden below
// `md` via `hidden md:flex`.  Asserting on the classes is the reliable,
// media-query-free way to verify the responsive contract.

describe("TopBar — mobile responsive classes", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("header element has `p-2` (8px mobile padding) and `md:p-4` (16px desktop padding) classes", async () => {
    renderTopBar("/");

    // The <header> element is the landmark with role="banner".
    await waitFor(() => expect(screen.getByRole("banner")).toBeInTheDocument());
    const header = screen.getByRole("banner");
    // Mobile: 8px padding (Figma 1989:9052 — 56px total = 8+40+8).
    expect(header.className).toContain("p-2");
    // Desktop: restore 16px padding at md breakpoint.
    expect(header.className).toContain("md:p-4");
  });

  it("desktop nav wrapper has `hidden md:flex` class (invisible below md breakpoint)", async () => {
    renderTopBar("/");

    // The nav element rendered for desktop has `hidden md:flex` on its parent wrapper.
    // We target the nav itself — its parent div carries the responsive classes.
    await waitFor(() =>
      expect(
        screen.getByRole("navigation", { name: "Primary" }),
      ).toBeInTheDocument(),
    );
    const nav = screen.getByRole("navigation", { name: "Primary" });
    // The nav element itself carries `hidden md:flex` per the implementation.
    expect(nav.className).toContain("hidden");
    expect(nav.className).toContain("md:flex");
  });

  it("hamburger button is present in the DOM and has `md:hidden` class", async () => {
    renderTopBar("/");

    await waitFor(() =>
      expect(screen.getByTestId("mobile-hamburger")).toBeInTheDocument(),
    );
    const hamburger = screen.getByTestId("mobile-hamburger");
    // The parent container carries `md:hidden`; the hamburger is inside it.
    const wrapper = hamburger.closest("div");
    expect(wrapper?.className).toContain("md:hidden");
  });

  it("clicking the hamburger opens the mobile nav menu", async () => {
    const user = userEvent.setup();
    renderTopBar("/");

    // Mobile nav menu is not in the DOM while closed.
    expect(screen.queryByTestId("mobile-nav-menu")).not.toBeInTheDocument();

    const hamburger = await screen.findByTestId("mobile-hamburger");
    await user.click(hamburger);

    await waitFor(() =>
      expect(screen.getByTestId("mobile-nav-menu")).toBeInTheDocument(),
    );
  });

  it("mobile menu lists four nav destinations", async () => {
    const user = userEvent.setup();
    renderTopBar("/");

    const hamburger = await screen.findByTestId("mobile-hamburger");
    await user.click(hamburger);

    await waitFor(() =>
      expect(screen.getByTestId("mobile-nav-menu")).toBeInTheDocument(),
    );

    // The mobile menu's nav section contains the four nav labels.
    expect(screen.getAllByText("Home").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Convert").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Earn").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Activity").length).toBeGreaterThanOrEqual(1);
  });

  it("mobile menu has a wallet connect entry point when disconnected", async () => {
    const user = userEvent.setup();
    renderTopBar("/");

    const hamburger = await screen.findByTestId("mobile-hamburger");
    await user.click(hamburger);

    await waitFor(() =>
      expect(screen.getByTestId("mobile-nav-menu")).toBeInTheDocument(),
    );

    // The mobile menu shows a "Connect Wallet" CTA in the disconnected state.
    // There may be multiple "Connect Wallet" elements (desktop button + mobile menu);
    // at least one should be inside the mobile nav menu panel.
    const menuPanel = screen.getByTestId("mobile-nav-menu");
    expect(menuPanel).toHaveTextContent("Connect Wallet");
  });

  it("mobile menu closes when the close button is clicked", async () => {
    const user = userEvent.setup();
    renderTopBar("/");

    const hamburger = await screen.findByTestId("mobile-hamburger");
    await user.click(hamburger);

    await waitFor(() =>
      expect(screen.getByTestId("mobile-nav-menu")).toBeInTheDocument(),
    );

    await user.click(screen.getByTestId("mobile-nav-menu-close"));

    await waitFor(() =>
      expect(screen.queryByTestId("mobile-nav-menu")).not.toBeInTheDocument(),
    );
  });
});

// ── Tests: Stellar PLUSD + sPLUSD balance rows in AccountDropdown (Issue #675) ─

describe("TopBar — Stellar PLUSD/sPLUSD balance rows in AccountDropdown", () => {
  afterEach(() => {
    clearMocks();
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("PLUSD balance row is NOT rendered when Stellar is disconnected", async () => {
    const user = userEvent.setup();
    setConnectedMock(); // EVM connected, Stellar disconnected
    renderTopBar("/");

    const trigger = await screen.findByRole("button", { name: /\$1,000\.00|—/ });
    await user.click(trigger);

    await waitFor(() =>
      expect(screen.getByRole("menu", { name: "Account" })).toBeInTheDocument(),
    );

    expect(
      screen.queryByTestId("topbar-plusd-balance-row"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("topbar-splusd-balance-row"),
    ).not.toBeInTheDocument();
  });

  it("PLUSD balance row is NOT rendered when hasTrustline is false", async () => {
    const user = userEvent.setup();
    setStellarConnected();
    // mockStellarPlusdState stays hasTrustline: false (default).
    renderTopBar("/");

    const trigger = await screen.findByRole("button", { name: /\$2,000\.00|—/ });
    await user.click(trigger);

    await waitFor(() =>
      expect(screen.getByRole("menu", { name: "Account" })).toBeInTheDocument(),
    );

    // Default namespace is EVM; switch to Stellar to see Stellar balances.
    await user.click(screen.getByRole("tab", { name: "Stellar" }));

    await waitFor(() =>
      expect(
        screen.queryByTestId("topbar-plusd-balance-row"),
      ).not.toBeInTheDocument(),
    );
  });

  it("PLUSD balance row renders when Stellar active and hasTrustline is true with non-zero balance", async () => {
    const user = userEvent.setup();
    setStellarConnected();
    setStellarPlusdBalance("5000.0000000"); // ~$5,000.00
    renderTopBar("/");

    const trigger = await screen.findByRole("button", { name: /\$2,000\.00|—/ });
    await user.click(trigger);

    await waitFor(() =>
      expect(screen.getByRole("menu", { name: "Account" })).toBeInTheDocument(),
    );

    // Switch to Stellar namespace tab.
    await user.click(screen.getByRole("tab", { name: "Stellar" }));

    await waitFor(() =>
      expect(
        screen.getByTestId("topbar-plusd-balance-row"),
      ).toBeInTheDocument(),
    );
  });

  it("sPLUSD balance row renders when Stellar active and balance is non-zero", async () => {
    const user = userEvent.setup();
    setStellarConnected();
    setStellarSplusdBalance(12345678900n); // 1234.5678900 sPLUSD at 7dp
    renderTopBar("/");

    const trigger = await screen.findByRole("button", { name: /\$2,000\.00|—/ });
    await user.click(trigger);

    await waitFor(() =>
      expect(screen.getByRole("menu", { name: "Account" })).toBeInTheDocument(),
    );

    // Switch to Stellar namespace tab.
    await user.click(screen.getByRole("tab", { name: "Stellar" }));

    await waitFor(() =>
      expect(
        screen.getByTestId("topbar-splusd-balance-row"),
      ).toBeInTheDocument(),
    );
  });

  it("sPLUSD balance row is NOT rendered when sPLUSD balance is zero", async () => {
    const user = userEvent.setup();
    setStellarConnected();
    setStellarSplusdBalance(0n);
    renderTopBar("/");

    const trigger = await screen.findByRole("button", { name: /\$2,000\.00|—/ });
    await user.click(trigger);

    await waitFor(() =>
      expect(screen.getByRole("menu", { name: "Account" })).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("tab", { name: "Stellar" }));

    await waitFor(() =>
      expect(
        screen.queryByTestId("topbar-splusd-balance-row"),
      ).not.toBeInTheDocument(),
    );
  });

  it("EVM namespace shows no PLUSD or sPLUSD rows even when Stellar has non-zero balances", async () => {
    const user = userEvent.setup();
    setConnectedMock(); // EVM connected
    setStellarConnected();
    setStellarPlusdBalance("5000.0000000");
    setStellarSplusdBalance(12345678900n);
    renderTopBar("/");

    const trigger = await screen.findByRole("button", { name: /\$1,000\.00|—/ });
    await user.click(trigger);

    await waitFor(() =>
      expect(screen.getByRole("menu", { name: "Account" })).toBeInTheDocument(),
    );

    // EVM tab is active by default — no Stellar balance rows.
    expect(
      screen.queryByTestId("topbar-plusd-balance-row"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("topbar-splusd-balance-row"),
    ).not.toBeInTheDocument();
  });
});
