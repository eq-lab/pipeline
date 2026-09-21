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
import { render, screen, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EvmWalletProvider } from "@/wallet/evm/EvmWalletProvider";

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

// Mock publicClient for gas estimation.
const mockEstimateContractGas = vi.fn(async () => 1_000_000n);
const mockPublicClient = { estimateContractGas: mockEstimateContractGas };
const mockUsePublicClient = vi.fn(() => mockPublicClient);

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
    usePublicClient: () => mockUsePublicClient(),
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
  STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  STELLAR_CHAIN_ID: 99_000_001,
  STELLAR_HORIZON_URL: "https://horizon-testnet.stellar.org",
  STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
  STELLAR_DEPOSIT_MANAGER_ID: "",
  STELLAR_WITHDRAWAL_QUEUE_ID: "",
  STELLAR_STAKED_PLUSD_ID: "",
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
function renderTestPage(
  tab: "status" | "mocks" | "toasts" | "auth" | string = "status",
) {
  // Patch Route.useSearch to return the requested tab value.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Route as any).useSearch = () => ({
    tab:
      tab === "mocks"
        ? "mocks"
        : tab === "toasts"
          ? "toasts"
          : tab === "auth"
            ? "auth"
            : "status",
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Route as any).useNavigate = () => mockNavigate;

  const TestPage = Route.options.component as React.ComponentType;
  return render(
    <EvmWalletProvider>
      <TestPage />
    </EvmWalletProvider>,
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

  it("renders the Stellar Environment section with its values on the Status tab", () => {
    renderTestPage("status");
    expect(screen.getByText("Environment (Stellar)")).toBeInTheDocument();
    expect(screen.getByText("STELLAR_NETWORK_PASSPHRASE")).toBeInTheDocument();
    expect(
      screen.getByText("Test SDF Network ; September 2015"),
    ).toBeInTheDocument();
    expect(screen.getByText("STELLAR_HORIZON_URL")).toBeInTheDocument();
    expect(
      screen.getByText("https://horizon-testnet.stellar.org"),
    ).toBeInTheDocument();
  });

  it("renders all expected section headings on the Status tab", () => {
    renderTestPage("status");
    expect(screen.getByText("Environment")).toBeInTheDocument();
    expect(screen.getByText("Wallet (useEvmWallet)")).toBeInTheDocument();
    expect(
      screen.getByText(
        "DepositManager (useDepositManagerAddresses + useDepositManagerMinDeposit)",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("USDC token (useEvmToken)")).toBeInTheDocument();
    expect(
      screen.getByText("ERC-20 Approval (useApproval — USDC → DepositManager)"),
    ).toBeInTheDocument();
  });

  it("Status tab has no content buttons (read-only — regression for #252)", () => {
    const { container } = renderTestPage("status");
    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBe(4);
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

  it("?tab=auth shows the Auth tab with an Open Sign In modal button", () => {
    renderTestPage("auth");
    expect(
      screen.getByRole("button", { name: /open sign in modal/i }),
    ).toBeInTheDocument();
  });

  it("?tab=auth opens SignInModal on click, closed by default", () => {
    renderTestPage("auth");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /open sign in modal/i }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("?tab=auth shows an Open Forgot Password screen trigger, closed by default", () => {
    renderTestPage("auth");
    expect(
      screen.queryByRole("dialog", { name: "Reset your password" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /open forgot password screen/i }),
    );
    expect(
      screen.getByRole("dialog", { name: "Reset your password" }),
    ).toBeInTheDocument();
  });

  it("swaps Sign In for Forgot Password instead of stacking them", () => {
    renderTestPage("auth");
    fireEvent.click(
      screen.getByRole("button", { name: /open sign in modal/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /forgot password\?/i }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(
      screen.getByRole("heading", { name: "Reset your password" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Sign in" }),
    ).not.toBeInTheDocument();
  });

  it("body scroll-lock survives the Sign In -> Forgot Password swap", () => {
    renderTestPage("auth");
    fireEvent.click(
      screen.getByRole("button", { name: /open sign in modal/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /forgot password\?/i }));
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(document.body.style.overflow).toBe("");
  });

  it('"Back to sign in" returns from Forgot Password to exactly one Sign in dialog', () => {
    renderTestPage("auth");
    fireEvent.click(
      screen.getByRole("button", { name: /open forgot password screen/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Back to sign in" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(
      screen.getByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
  });

  it("submitting a valid email on Forgot Password closes it and shows the stand-in line", async () => {
    const user = userEvent.setup();
    renderTestPage("auth");
    fireEvent.click(
      screen.getByRole("button", { name: /open forgot password screen/i }),
    );
    await user.type(
      screen.getByPlaceholderText("Enter corporate email"),
      "lp@example.com",
    );
    await user.click(screen.getByRole("button", { name: "Send Reset Link" }));
    expect(
      screen.getByTestId("auth-forgot-password-submitted"),
    ).toHaveTextContent(
      "Reset link requested — #1265 wires this to the real password-reset endpoint.",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("?tab=auth shows an Open Create Account modal button", () => {
    renderTestPage("auth");
    expect(
      screen.getByRole("button", { name: /open create account modal/i }),
    ).toBeInTheDocument();
  });

  it("?tab=auth opens CreateAccountModal on click, closed by default", () => {
    renderTestPage("auth");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /open create account modal/i }),
    );
    expect(
      screen.getByRole("heading", { name: "Create account" }),
    ).toBeInTheDocument();
  });

  it("?tab=auth shows an Open OTP screen button", () => {
    renderTestPage("auth");
    expect(
      screen.getByRole("button", { name: /open otp screen/i }),
    ).toBeInTheDocument();
  });

  it("?tab=auth opens the OTP screen on click, closed by default", () => {
    renderTestPage("auth");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /open otp screen/i }));
    expect(
      screen.getByRole("dialog", { name: "Check your inbox" }),
    ).toBeInTheDocument();
  });

  it("?tab=auth shows an Open Company Docs step button", () => {
    renderTestPage("auth");
    expect(
      screen.getByRole("button", { name: /open company docs step/i }),
    ).toBeInTheDocument();
  });

  it("?tab=auth opens CompanyDocsModal on click, closed by default", () => {
    renderTestPage("auth");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /open company docs step/i }),
    );
    expect(
      screen.getByRole("dialog", { name: "Finish account setup" }),
    ).toBeInTheDocument();
  });

  it("?tab=auth shows the reworded OTP-verified stand-in copy after verifying", async () => {
    const user = userEvent.setup();
    renderTestPage("auth");
    fireEvent.click(screen.getByRole("button", { name: /open otp screen/i }));
    const input = screen.getByLabelText("Verification code");
    await user.click(input);
    await user.paste("123456");
    expect(
      await screen.findByTestId("auth-otp-verified", {}, { timeout: 2000 }),
    ).toHaveTextContent(
      "OTP verified — open the Company Docs step from the button above.",
    );
  });

  it("?tab=auth shows the company-docs-submitted line after submitting all five documents", () => {
    renderTestPage("auth");
    fireEvent.click(
      screen.getByRole("button", { name: /open company docs step/i }),
    );

    const inputs = screen.getAllByTestId(/-file-input$/);
    expect(inputs).toHaveLength(5);
    inputs.forEach((input, i) => {
      const file = new File(["x"], `doc-${i}.pdf`, {
        type: "application/pdf",
      });
      fireEvent.change(input, { target: { files: [file] } });
    });

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByTestId("auth-company-docs-submitted")).toHaveTextContent(
      "Company documents submitted — open the Account-in-review screen from the button above.",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("?tab=auth has no Open Owners step trigger (retired)", () => {
    renderTestPage("auth");
    expect(
      screen.queryByRole("button", { name: /open owners step/i }),
    ).not.toBeInTheDocument();
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
      <EvmWalletProvider>
        <TestPage />
      </EvmWalletProvider>,
    );

    const mockedBadges = screen.getAllByText("MOCKED");
    expect(mockedBadges.length).toBeGreaterThan(0);
  });
});
