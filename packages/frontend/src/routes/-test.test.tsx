/**
 * Smoke tests for the /test diagnostic page.
 *
 * Verifies that the page renders without throwing, that all expected section
 * headings are present, and that setting a mock key in localStorage causes a
 * MOCKED badge to appear next to the relevant row.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, act } from "@testing-library/react";
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

// ── Mock TanStack Router (TopBar uses useNavigate / useRouterState) ───────────

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...original,
    useNavigate: vi.fn(() => vi.fn()),
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

// ── Helpers ───────────────────────────────────────────────────────────────────

// Import the page component directly — avoids needing a full RouterProvider.
// The createFileRoute wrapper exports the component via `.component`.
// We import just the function component to render it in isolation.
import { Route } from "./test";

function renderTestPage() {
  const TestPage = Route.options.component as React.ComponentType;
  return render(
    <WalletProvider>
      <TestPage />
    </WalletProvider>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("TestPage — smoke render", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders without throwing", () => {
    expect(() => renderTestPage()).not.toThrow();
  });

  it("renders the Environment section heading", () => {
    renderTestPage();
    expect(screen.getByText("Environment")).toBeInTheDocument();
  });

  it("renders all expected section headings", () => {
    renderTestPage();
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
    expect(screen.getByText("Write hooks")).toBeInTheDocument();
  });

  it("shows the zero-address note for DEPOSIT_MANAGER_ADDRESS", () => {
    renderTestPage();
    // The note is an inline span sibling; query it by its text content directly.
    expect(
      screen.getByText(
        (content) =>
          content.includes("zero-address") &&
          content.includes("DM hooks short-circuit"),
      ),
    ).toBeInTheDocument();
  });

  it("shows the replace-me note for WALLETCONNECT_PROJECT_ID", () => {
    renderTestPage();
    // The note is rendered as a sibling span; match it by its exact text.
    expect(
      screen.getByText((content) => content.includes("replace-me placeholder")),
    ).toBeInTheDocument();
  });
});

describe("TestPage — MOCKED badge plumbing", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows a MOCKED badge next to address when pipeline.mock.wallet.address is set", () => {
    // Set the mock key before rendering so isMockKeyPresent picks it up
    localStorage.setItem(
      "pipeline.mock.wallet.address",
      "0x1234000000000000000000000000000000000000",
    );

    renderTestPage();

    // There should be at least one MOCKED badge in the document
    const mockedBadges = screen.getAllByText("MOCKED");
    expect(mockedBadges.length).toBeGreaterThan(0);
  });

  it("does NOT show MOCKED badges when no mock keys are set", () => {
    renderTestPage();
    expect(screen.queryByText("MOCKED")).not.toBeInTheDocument();
  });

  it("shows MOCKED badge when mock key is set and re-rendered", () => {
    const { rerender } = renderTestPage();
    expect(screen.queryByText("MOCKED")).not.toBeInTheDocument();

    // Set the mock key and re-render
    act(() => {
      localStorage.setItem(
        "pipeline.mock.wallet.address",
        "0xabcd000000000000000000000000000000000000",
      );
    });

    // Re-render the component — isMockKeyPresent is called on each render
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
