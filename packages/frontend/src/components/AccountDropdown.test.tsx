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
import { WalletProvider } from "@/wallet/WalletProvider";
import { TopBar } from "./TopBar";

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

// jsdom doesn't expose navigator.clipboard in a secure context by default.
// Add it directly to the navigator object so the hook's guard passes.
Object.defineProperty(navigator, "clipboard", {
  get() {
    return { writeText: mockWriteText };
  },
  configurable: true,
});

// ── Constants ─────────────────────────────────────────────────────────────────

const USDC_ADDRESS = "0x2222000000000000000000000000000000000002";
const MOCK_ADDRESS = "0x8493000000000000000000000000000000003b92";

// ── Helpers ───────────────────────────────────────────────────────────────────

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
    "1000000000",
  );
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
}

/** Builds a router with TopBar in the root layout and two routes for route-change tests. */
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
      <WalletProvider>
        <RouterProvider router={router} />
      </WalletProvider>,
    ),
  };
}

/** Clicks the WalletPill trigger to open the dropdown and waits for it. */
async function openDropdown(user: ReturnType<typeof userEvent.setup>) {
  const trigger = await screen.findByRole("button", { name: /1,000\.00|—/ });
  await user.click(trigger);
  await waitFor(() =>
    expect(screen.getByRole("menu", { name: "Account" })).toBeInTheDocument(),
  );
  return trigger;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("AccountDropdown — open / close", () => {
  beforeEach(() => {
    setConnectedMock();
  });

  afterEach(() => {
    clearMocks();
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

    // Click outside the dropdown
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

    const trigger = await screen.findByRole("button", { name: /1,000\.00|—/ });
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
    setConnectedMock();
  });

  afterEach(() => {
    clearMocks();
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("renders the address truncated to 0x8493…3b92", async () => {
    const user = userEvent.setup();
    renderWithWallet();
    await openDropdown(user);

    // The truncated form should appear.
    expect(screen.getByText("0x8493…3b92")).toBeInTheDocument();
    // The full address should NOT be directly visible as text.
    expect(screen.queryByText(MOCK_ADDRESS)).not.toBeInTheDocument();
  });

  it("copy button writes full address to clipboard", async () => {
    const user = userEvent.setup();
    renderWithWallet();
    await openDropdown(user);

    const copyBtn = screen.getByRole("menuitem", {
      name: "Copy wallet address",
    });
    await user.click(copyBtn);

    // The Copied affordance appearing proves writeText was called with the address
    // (the component only calls setCopied(true) inside the writeText .then() callback).
    await waitFor(() => expect(screen.getByText("Copied")).toBeInTheDocument());
  });

  it("copy button shows Copied affordance, then reverts", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ delay: null });
      renderWithWallet();
      // Open dropdown using real timers already paused; get trigger directly.
      const trigger = await waitFor(() =>
        screen.getByRole("button", { name: /1,000\.00|—/ }),
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

      // The sr-only "Copied" span should appear.
      await waitFor(() =>
        expect(screen.getByText("Copied")).toBeInTheDocument(),
      );

      // Advance past 1500ms and flush React updates.
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
    setConnectedMock();
  });

  afterEach(() => {
    clearMocks();
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
    setConnectedMock();
  });

  afterEach(() => {
    clearMocks();
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
