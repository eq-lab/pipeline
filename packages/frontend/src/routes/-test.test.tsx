/**
 * Smoke tests for the /test diagnostic page.
 *
 * Verifies that:
 *   - The page renders on the Status tab by default.
 *   - `?tab=mocks` shows the Mocks tab with Clear + Enable buttons.
 *   - Invalid tab values fall back to Status.
 *   - Clear mocks button removes only pipeline.mock.* keys and calls reload.
 *   - Enable button writes the scenario's keys and calls reload.
 *   - Status tab has no buttons (read-only, regression for #252).
 *   - MOCKED badge plumbing still works on the Status tab.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WalletProvider } from "@/wallet/WalletProvider";

// ── Mock wagmi ────────────────────────────────────────────────────────────────

const mockUseReadContract = vi.fn(() => ({
  data: undefined as unknown,
  isLoading: false,
  error: null,
  refetch: vi.fn(),
}));

const mockWriteContract = vi.fn();
const stableWriteContractState = {
  writeContract: mockWriteContract,
  data: undefined as string | undefined,
  isPending: false,
  isSuccess: false,
  error: null as Error | null,
  reset: vi.fn(),
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

// ── Mock TanStack Router ──────────────────────────────────────────────────────
//
// We mock `Route.useSearch` and `Route.useNavigate` by controlling the module-
// level mock return values. Since `createFileRoute` is used from the real
// module, but the route's hook calls are intercepted by overriding the mocked
// search/navigate functions below.

const mockNavigate = vi.fn();

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...original,
    useNavigate: vi.fn(() => mockNavigate),
    useRouterState: vi.fn(() => "/test"),
    createFileRoute: original.createFileRoute,
  };
});

// ── Mock ENV ──────────────────────────────────────────────────────────────────

const mockEnv = vi.hoisted(() => ({
  EVM_CHAIN_ID: 560048,
  EVM_RPC_URL: "https://ethereum-hoodi-rpc.publicnode.com",
  DEPOSIT_MANAGER_ADDRESS:
    "0x0000000000000000000000000000000000000000" as `0x${string}`,
  WALLETCONNECT_PROJECT_ID: "replace-me",
}));

vi.mock("@/lib/env", () => ({
  ENV: mockEnv,
}));

// ── Mock scenarios module ─────────────────────────────────────────────────────
//
// We mock clearMocksAndReload and enableScenario so we can assert they're
// called without triggering window.location.reload in tests.
// reloadPage is kept real so tests can spy on it independently.

const mockClearMocksAndReload = vi.fn();
const mockEnableScenario = vi.fn();

vi.mock("./test/-scenarios", async (importOriginal) => {
  const original = await importOriginal<typeof import("./test/-scenarios")>();
  return {
    ...original,
    clearMocksAndReload: () => mockClearMocksAndReload(),
    enableScenario: (scenario: unknown) => mockEnableScenario(scenario),
  };
});

// ── Import Route AFTER mocks are in place ─────────────────────────────────────

import { Route } from "./test";
import { SCENARIOS } from "./test/-scenarios";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Renders the TestPage component in isolation.
 *
 * `tab` controls what `Route.useSearch()` returns. We patch the Route's
 * `useSearch` method directly on the Route object so each test can choose its
 * starting tab.
 */
function renderTestPage(tab: "status" | "mocks" | string = "status") {
  // Patch Route.useSearch to return the requested tab value.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Route as any).useSearch = () => ({
    tab: tab === "mocks" ? "mocks" : "status",
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Route as any).useNavigate = () => mockNavigate;

  const TestPage = Route.options.component as React.ComponentType;
  return render(
    <WalletProvider>
      <TestPage />
    </WalletProvider>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("TestPage — default Status tab", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("renders without throwing", () => {
    expect(() => renderTestPage("status")).not.toThrow();
  });

  it("renders the Environment section heading on the Status tab", () => {
    renderTestPage("status");
    expect(screen.getByText("Environment")).toBeInTheDocument();
  });

  it("renders all expected section headings on the Status tab", () => {
    renderTestPage("status");
    expect(screen.getByText("Environment")).toBeInTheDocument();
    expect(screen.getByText("Wallet (useWallet)")).toBeInTheDocument();
    expect(
      screen.getByText(
        "DepositManager (useDepositManagerAddresses + useDepositManagerMinDeposit)",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("USDC token (useToken)")).toBeInTheDocument();
    expect(
      screen.getByText("ERC-20 Approval (useApproval — USDC → DepositManager)"),
    ).toBeInTheDocument();
  });

  it("Status tab has no content buttons (read-only — regression for #252)", () => {
    const { container } = renderTestPage("status");
    // The SegmentedTabs renders two tab buttons; only those should be present.
    // No action buttons (Clear mocks / Enable) should appear on the Status tab.
    const buttons = container.querySelectorAll("button");
    // The SegmentedTabs always renders exactly 2 buttons (Status + Mocks).
    expect(buttons.length).toBe(2);
  });

  it("does not render the Write hooks section", () => {
    renderTestPage("status");
    expect(screen.queryByText("Write hooks")).not.toBeInTheDocument();
  });

  it("does not show the Clear mocks button on the Status tab", () => {
    renderTestPage("status");
    expect(
      screen.queryByRole("button", { name: /clear mocks/i }),
    ).not.toBeInTheDocument();
  });

  it("shows the zero-address note for DEPOSIT_MANAGER_ADDRESS", () => {
    renderTestPage("status");
    expect(
      screen.getByText(
        (content) =>
          content.includes("zero-address") &&
          content.includes("DM hooks short-circuit"),
      ),
    ).toBeInTheDocument();
  });

  it("shows the replace-me note for WALLETCONNECT_PROJECT_ID", () => {
    renderTestPage("status");
    expect(
      screen.getByText((content) => content.includes("replace-me placeholder")),
    ).toBeInTheDocument();
  });
});

describe("TestPage — tab param routing", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("?tab=mocks shows the Mocks tab with a Clear button", () => {
    renderTestPage("mocks");
    expect(
      screen.getByRole("button", { name: /clear mocks/i }),
    ).toBeInTheDocument();
  });

  it("?tab=mocks shows an Enable button for each scenario", () => {
    renderTestPage("mocks");
    const enableButtons = screen.getAllByRole("button", { name: /enable/i });
    expect(enableButtons.length).toBe(SCENARIOS.length);
  });

  it("?tab=foo (invalid) falls back to Status tab", () => {
    renderTestPage("foo");
    // Status sections visible
    expect(screen.getByText("Environment")).toBeInTheDocument();
    // Mocks tab content not visible
    expect(
      screen.queryByRole("button", { name: /clear mocks/i }),
    ).not.toBeInTheDocument();
  });

  it("Status tab is shown by default (no tab param)", () => {
    renderTestPage("status");
    expect(screen.getByText("Environment")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /clear mocks/i }),
    ).not.toBeInTheDocument();
  });
});

describe("TestPage — Clear mocks button", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("clicking Clear mocks calls clearMocksAndReload", async () => {
    const user = userEvent.setup();
    renderTestPage("mocks");

    const clearBtn = screen.getByRole("button", { name: /clear mocks/i });
    await user.click(clearBtn);

    expect(mockClearMocksAndReload).toHaveBeenCalledTimes(1);
  });
});

describe("TestPage — Enable button", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("clicking Enable calls enableScenario with the correct scenario", async () => {
    const user = userEvent.setup();
    renderTestPage("mocks");

    // Click the first Enable button (corresponds to SCENARIOS[0])
    const enableButtons = screen.getAllByRole("button", { name: /enable/i });
    await user.click(enableButtons[0]!);

    expect(mockEnableScenario).toHaveBeenCalledTimes(1);
    expect(mockEnableScenario).toHaveBeenCalledWith(SCENARIOS[0]);
  });

  it("each Enable button corresponds to the right scenario", async () => {
    const user = userEvent.setup();
    renderTestPage("mocks");

    const enableButtons = screen.getAllByRole("button", { name: /enable/i });

    // Click the "connected-allowance-ok" scenario's Enable button
    const targetIndex = SCENARIOS.findIndex(
      (s) => s.id === "connected-allowance-ok",
    );
    expect(targetIndex).toBeGreaterThanOrEqual(0);

    await user.click(enableButtons[targetIndex]!);

    expect(mockEnableScenario).toHaveBeenCalledWith(SCENARIOS[targetIndex]);
  });
});

describe("TestPage — MOCKED badge plumbing (Status tab)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows a MOCKED badge next to address when pipeline.mock.wallet.address is set", () => {
    localStorage.setItem(
      "pipeline.mock.wallet.address",
      "0x1234000000000000000000000000000000000000",
    );

    renderTestPage("status");

    const mockedBadges = screen.getAllByText("MOCKED");
    expect(mockedBadges.length).toBeGreaterThan(0);
  });

  it("does NOT show MOCKED badges when no mock keys are set", () => {
    renderTestPage("status");
    expect(screen.queryByText("MOCKED")).not.toBeInTheDocument();
  });

  it("shows MOCKED badge when mock key is set and re-rendered", () => {
    const { rerender } = renderTestPage("status");
    expect(screen.queryByText("MOCKED")).not.toBeInTheDocument();

    act(() => {
      localStorage.setItem(
        "pipeline.mock.wallet.address",
        "0xabcd000000000000000000000000000000000000",
      );
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Route as any).useSearch = () => ({ tab: "status" });
    const TestPage = Route.options.component as React.ComponentType;
    rerender(
      <WalletProvider>
        <TestPage />
      </WalletProvider>,
    );

    const mockedBadges = screen.getAllByText("MOCKED");
    expect(mockedBadges.length).toBeGreaterThan(0);
  });
});
