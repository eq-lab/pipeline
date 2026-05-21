/**
 * TopBar — unit tests.
 *
 * Tests route-derived active nav, disconnected vs connected state (via the
 * mock-wallet localStorage keys), and a smoke test that the header renders
 * on non-`/` routes (regression guard for the root-layout approach).
 *
 * All wallet state is driven via `pipeline.mock.wallet.*` localStorage keys —
 * no provider mocking needed (the mock layer is the documented testing pattern).
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
import { WalletProvider } from "@/wallet/WalletProvider";
import { TopBar } from "./TopBar";

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
    <WalletProvider>
      <RouterProvider router={router} />
    </WalletProvider>,
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

  it("highlights Convert on /withdraw (withdraw shares the dollar icon)", async () => {
    renderTopBar("/withdraw");
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

    // Wait for connected state.
    const trigger = await screen.findByRole("button", {
      name: /\$1,000\.00|—/,
    });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    // The Account dropdown panel should be present.
    expect(screen.getByRole("menu", { name: "Account" })).toBeInTheDocument();
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

    // Wait for the router to hydrate and the TopBar to render.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Home" })).toBeInTheDocument(),
    );
    // The logo is rendered inside the TopBar — confirm it exists on /deposit.
    expect(
      screen.getByRole("navigation", { name: "Primary" }),
    ).toBeInTheDocument();
  });
});
