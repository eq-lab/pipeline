/**
 * TopBar — unit tests.
 *
 * Tests route-derived active nav, disconnected vs connected state (via the
 * mock-wallet localStorage keys), and a smoke test that the header renders
 * on non-`/` routes (regression guard for the root-layout approach).
 *
 * Also covers:
 *   - Neither wallet connected → "Connect Wallet" present; clicking opens
 *     ConnectChooserModal with "Connect EVM" / "Connect Stellar" buttons.
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
import { TopBar } from "./TopBar";

// ── Stellar hook mocks ────────────────────────────────────────────────────────

const {
  mockStellarConnect,
  mockStellarDisconnect2,
  mockStellarWalletState,
  mockStellarTokenState,
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
}));

vi.mock("@/wallet/stellar/useStellarWallet", () => ({
  useStellarWallet: () => ({
    ...mockStellarWalletState,
    connect: mockStellarConnect,
    disconnect: mockStellarDisconnect2,
  }),
}));

vi.mock("@/wallet/stellar/useStellarToken", () => ({
  useStellarToken: () => ({ ...mockStellarTokenState }),
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
    <EvmWalletProvider>
      <WalletViewProvider>
        <RouterProvider router={router} />
      </WalletViewProvider>
    </EvmWalletProvider>,
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

// ── Tests: ConnectChooserModal integration ────────────────────────────────────

describe("TopBar — ConnectChooserModal", () => {
  afterEach(() => {
    clearMocks();
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("clicking Connect Wallet opens ConnectChooserModal", async () => {
    const user = userEvent.setup();
    renderTopBar("/");

    const connectBtn = await screen.findByRole("button", {
      name: "Connect Wallet",
    });
    await user.click(connectBtn);

    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "Connect a wallet" }),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "Connect EVM" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Connect Stellar" }),
    ).toBeInTheDocument();
  });

  it("clicking Connect EVM in the chooser modal dismisses it", async () => {
    const user = userEvent.setup();
    renderTopBar("/");

    await user.click(
      await screen.findByRole("button", { name: "Connect Wallet" }),
    );
    await screen.findByRole("dialog", { name: "Connect a wallet" });

    await user.click(screen.getByRole("button", { name: "Connect EVM" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Connect a wallet" }),
      ).not.toBeInTheDocument();
    });
  });

  it("clicking Connect Stellar in the chooser modal calls stellar.connect and dismisses", async () => {
    const user = userEvent.setup();
    renderTopBar("/");

    await user.click(
      await screen.findByRole("button", { name: "Connect Wallet" }),
    );
    await screen.findByRole("dialog", { name: "Connect a wallet" });

    await user.click(screen.getByRole("button", { name: "Connect Stellar" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Connect a wallet" }),
      ).not.toBeInTheDocument();
    });
    expect(mockStellarConnect).toHaveBeenCalledOnce();
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
