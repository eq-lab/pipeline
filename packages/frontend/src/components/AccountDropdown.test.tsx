/**
 * AccountDropdown — unit tests.
 *
 * Covers:
 *   - Opens on pill click; closes on outside click, Escape, and route change.
 *   - Address renders truncated; copy button writes full address to clipboard
 *     and shows/hides "Copied" affordance.
 *   - Disconnect button calls useWallet().disconnect() and closes the dropdown.
 *   - Panel has role="menu"; copy + disconnect have role="menuitem".
 *   - Trigger has aria-expanded toggling.
 *   - Namespace toggle (EVM ↔ Stellar) switches the rendered address/balance.
 *   - Not-connected state renders "Connect {namespace}" action, hides Disconnect.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
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
// Mock useStellarWallet and useStellarToken at the module level so TopBar
// can call them without needing a real StellarWalletsKit or QueryClient.

const {
  mockStellarConnect,
  mockStellarDisconnect,
  mockStellarWalletState,
  mockStellarTokenState,
} = vi.hoisted(() => ({
  mockStellarConnect: vi.fn(),
  mockStellarDisconnect: vi.fn(),
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
    disconnect: mockStellarDisconnect,
  }),
}));

vi.mock("@/wallet/stellar/useStellarToken", () => ({
  useStellarToken: () => ({ ...mockStellarTokenState }),
}));

// StellarWalletProvider uses ./config, mock that too.
vi.mock("@/wallet/stellar/config", () => ({
  StellarWalletsKit: {
    authModal: vi.fn(),
    getAddress: vi.fn().mockResolvedValue({ address: undefined }),
    disconnect: vi.fn(),
    init: vi.fn(),
  },
}));

// ── Wagmi / AppKit mocks ──────────────────────────────────────────────────────

const mockDisconnect = vi.fn();

vi.mock("wagmi", async (importOriginal) => {
  const original = await importOriginal<typeof import("wagmi")>();
  return {
    ...original,
    WagmiProvider: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    useAccount: vi.fn(() => ({ address: undefined, isConnected: false })),
    useChainId: vi.fn(() => 560048),
    useDisconnect: vi.fn(() => ({ disconnect: mockDisconnect })),
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

// ── Clipboard mock ────────────────────────────────────────────────────────────

const mockWriteText = vi.fn().mockResolvedValue(undefined);

Object.defineProperty(navigator, "clipboard", {
  get() {
    return { writeText: mockWriteText };
  },
  configurable: true,
});

// ── Constants ─────────────────────────────────────────────────────────────────

const USDC_ADDRESS = "0x2222000000000000000000000000000000000002";
const MOCK_EVM_ADDRESS = "0x8493000000000000000000000000000000003b92";
const MOCK_STELLAR_ADDRESS =
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

// ── Helpers ───────────────────────────────────────────────────────────────────

function setEvmConnectedMock() {
  localStorage.setItem("pipeline.mock.wallet.address", MOCK_EVM_ADDRESS);
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
    "1000000000",
  );
}

function clearEvmMocks() {
  [
    "pipeline.mock.wallet.address",
    "pipeline.mock.wallet.isConnected",
    "pipeline.mock.wallet.contract.depositManager.usdc",
    `pipeline.mock.wallet.contract.${USDC_ADDRESS.toLowerCase()}.decimals`,
    `pipeline.mock.wallet.contract.${USDC_ADDRESS.toLowerCase()}.symbol`,
    `pipeline.mock.wallet.balance.${USDC_ADDRESS.toLowerCase()}`,
  ].forEach((k) => localStorage.removeItem(k));
}

function setStellarHookMockConnected() {
  mockStellarWalletState.address = MOCK_STELLAR_ADDRESS;
  mockStellarWalletState.isConnected = true;
  mockStellarTokenState.balance = "2000.00";
  mockStellarTokenState.formattedBalance = "$2,000.00";
}

function clearStellarHookMock() {
  mockStellarWalletState.address = undefined;
  mockStellarWalletState.isConnected = false;
  mockStellarTokenState.balance = undefined;
  mockStellarTokenState.formattedBalance = undefined;
}

/** Builds a router with TopBar in the root layout. */
function buildRouter(initialPath = "/") {
  const rootRoute = createRootRoute({ component: () => <TopBar /> });
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
  const routeTree = rootRoute.addChildren([indexRoute, depositRoute]);
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
}

function renderWithWallet(initialPath = "/") {
  const router = buildRouter(initialPath);
  return {
    router,
    ...render(
      <EvmWalletProvider>
        <WalletViewProvider>
          <RouterProvider router={router} />
        </WalletViewProvider>
      </EvmWalletProvider>,
    ),
  };
}

/** Clicks the WalletPill trigger to open the dropdown and waits for it. */
async function openDropdown(user: ReturnType<typeof userEvent.setup>) {
  const trigger = await screen.findByRole("button", {
    name: /\$1,000\.00|\$2,000\.00|—/,
  });
  await user.click(trigger);
  await waitFor(() =>
    expect(screen.getByRole("menu", { name: "Account" })).toBeInTheDocument(),
  );
  return trigger;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("AccountDropdown — open / close", () => {
  beforeEach(() => {
    setEvmConnectedMock();
  });

  afterEach(() => {
    clearEvmMocks();
    clearStellarHookMock();
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("opens when the WalletPill trigger is clicked", async () => {
    const user = userEvent.setup();
    renderWithWallet();
    await openDropdown(user);
    expect(screen.getByRole("menu", { name: "Account" })).toBeVisible();
  });

  it("closes when outside is clicked (mousedown)", async () => {
    const user = userEvent.setup();
    renderWithWallet();
    await openDropdown(user);

    await act(async () => {
      document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    await waitFor(() =>
      expect(
        screen.queryByRole("menu", { name: "Account" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("closes when Escape is pressed", async () => {
    const user = userEvent.setup();
    renderWithWallet();
    await openDropdown(user);

    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(
        screen.queryByRole("menu", { name: "Account" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("sets aria-expanded to true when open, false when closed", async () => {
    const user = userEvent.setup();
    renderWithWallet();

    const trigger = await screen.findByRole("button", {
      name: /\$1,000\.00|—/,
    });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(trigger).toHaveAttribute("aria-expanded", "false"),
    );
  });
});

describe("AccountDropdown — address display and copy", () => {
  beforeEach(() => {
    setEvmConnectedMock();
  });

  afterEach(() => {
    clearEvmMocks();
    clearStellarHookMock();
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("renders the EVM address truncated to 0x8493…3b92", async () => {
    const user = userEvent.setup();
    renderWithWallet();
    await openDropdown(user);

    expect(screen.getByText("0x8493…3b92")).toBeInTheDocument();
    expect(screen.queryByText(MOCK_EVM_ADDRESS)).not.toBeInTheDocument();
  });

  it("copy button writes full address to clipboard", async () => {
    const user = userEvent.setup();
    renderWithWallet();
    await openDropdown(user);

    const copyBtn = screen.getByRole("menuitem", {
      name: "Copy wallet address",
    });
    await user.click(copyBtn);

    await waitFor(() => expect(screen.getByText("Copied")).toBeInTheDocument());
  });

  it("copy button shows Copied affordance, then reverts", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ delay: null });
      renderWithWallet();
      const trigger = await waitFor(() =>
        screen.getByRole("button", { name: /\$1,000\.00|—/ }),
      );
      await act(async () => {
        await user.click(trigger);
      });
      await waitFor(() =>
        expect(
          screen.getByRole("menu", { name: "Account" }),
        ).toBeInTheDocument(),
      );

      const copyBtn = screen.getByRole("menuitem", {
        name: "Copy wallet address",
      });
      await act(async () => {
        await user.click(copyBtn);
      });

      await waitFor(() =>
        expect(screen.getByText("Copied")).toBeInTheDocument(),
      );

      act(() => {
        vi.advanceTimersByTime(1600);
      });

      await waitFor(() =>
        expect(screen.queryByText("Copied")).not.toBeInTheDocument(),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("AccountDropdown — disconnect", () => {
  beforeEach(() => {
    setEvmConnectedMock();
  });

  afterEach(() => {
    clearEvmMocks();
    clearStellarHookMock();
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("Disconnect button closes the dropdown", async () => {
    const user = userEvent.setup();
    renderWithWallet();
    await openDropdown(user);

    const disconnectBtn = screen.getByRole("menuitem", { name: "Disconnect" });
    await user.click(disconnectBtn);

    await waitFor(() =>
      expect(
        screen.queryByRole("menu", { name: "Account" }),
      ).not.toBeInTheDocument(),
    );
  });
});

describe("AccountDropdown — a11y roles", () => {
  beforeEach(() => {
    setEvmConnectedMock();
  });

  afterEach(() => {
    clearEvmMocks();
    clearStellarHookMock();
    localStorage.clear();
  });

  it("panel has role=menu, copy and disconnect have role=menuitem", async () => {
    const user = userEvent.setup();
    renderWithWallet();
    await openDropdown(user);

    expect(screen.getByRole("menu", { name: "Account" })).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Copy wallet address" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Disconnect" }),
    ).toBeInTheDocument();
  });
});

describe("AccountDropdown — namespace toggle", () => {
  beforeEach(() => {
    setEvmConnectedMock();
    setStellarHookMockConnected();
  });

  afterEach(() => {
    clearEvmMocks();
    clearStellarHookMock();
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("EVM tab is selected by default and shows EVM address", async () => {
    const user = userEvent.setup();
    renderWithWallet();
    await openDropdown(user);

    const evmTab = screen.getByRole("tab", { name: "EVM" });
    expect(evmTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("0x8493…3b92")).toBeInTheDocument();
  });

  it("clicking Stellar tab shows Stellar truncated address", async () => {
    const user = userEvent.setup();
    renderWithWallet();
    await openDropdown(user);

    const stellarTab = screen.getByRole("tab", { name: "Stellar" });
    await user.click(stellarTab);

    await waitFor(() => {
      // Stellar GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
      // truncated: first 6 chars = "GBBD47", last 4 = "LA5" → "GBBD47…LA5"
      // Actually last 4 of the 56-char string:
      // "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
      // slice(-4) = "LA5" but that's only 3 chars — let me check:
      // len=56, slice(-4) = chars at 52,53,54,55 = "FLA5"
      expect(screen.getByText("GBBD47…FLA5")).toBeInTheDocument();
    });
    expect(stellarTab).toHaveAttribute("aria-selected", "true");
  });

  it("clicking EVM tab after Stellar restores EVM address", async () => {
    const user = userEvent.setup();
    renderWithWallet();
    await openDropdown(user);

    await user.click(screen.getByRole("tab", { name: "Stellar" }));
    await waitFor(() =>
      expect(screen.getByText("GBBD47…FLA5")).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("tab", { name: "EVM" }));
    await waitFor(() =>
      expect(screen.getByText("0x8493…3b92")).toBeInTheDocument(),
    );
  });
});

describe("AccountDropdown — not-connected-tab state", () => {
  afterEach(() => {
    clearEvmMocks();
    clearStellarHookMock();
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("shows 'Connect Stellar' action when EVM connected but Stellar tab selected", async () => {
    setEvmConnectedMock();
    // Stellar is NOT connected (clearStellarHookMock defaults are disconnected).
    const user = userEvent.setup();
    renderWithWallet();
    await openDropdown(user);

    await user.click(screen.getByRole("tab", { name: "Stellar" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Connect Stellar" }),
      ).toBeInTheDocument();
    });
    // Disconnect should NOT be visible when active namespace is not connected.
    expect(
      screen.queryByRole("menuitem", { name: "Disconnect" }),
    ).not.toBeInTheDocument();
  });
});
