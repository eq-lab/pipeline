import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { renderHook } from "@testing-library/react";
import { EvmWalletProvider } from "./EvmWalletProvider";
import { useContractRead } from "./useEvmWallet";

// ── Mock wagmi ────────────────────────────────────────────────────────────────

const mockUseReadContract = vi.fn(() => ({
  data: undefined as unknown,
  isLoading: false,
  error: null,
}));

vi.mock("wagmi", async (importOriginal) => {
  const original = await importOriginal<typeof import("wagmi")>();
  return {
    ...original,
    WagmiProvider: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    useAccount: vi.fn(() => ({ address: undefined, isConnected: false })),
    useChainId: vi.fn(() => 1),
    useDisconnect: vi.fn(() => ({ disconnect: vi.fn() })),
    useReadContract: (...args: Parameters<typeof mockUseReadContract>) =>
      mockUseReadContract(...args),
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

vi.mock("./config", () => ({
  wagmiConfig: {},
  wagmiAdapter: {},
}));

// ── Minimal test ABI ──────────────────────────────────────────────────────────

const testAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

function wrapper({ children }: { children: React.ReactNode }) {
  return <EvmWalletProvider>{children}</EvmWalletProvider>;
}

describe("useContractRead — mock mode", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseReadContract.mockClear();
  });

  it("returns mocked value when contract mock key is set", () => {
    // Key uses lowercased address
    localStorage.setItem(
      "pipeline.mock.wallet.contract.0xabc123.balanceOf",
      JSON.stringify("42"),
    );

    const { result } = renderHook(
      () =>
        useContractRead({
          address: "0xabc123",
          abi: testAbi,
          functionName: "balanceOf",
          args: ["0x0000000000000000000000000000000000000001"],
        }),
      { wrapper },
    );

    expect(result.current.data).toBe("42");
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("address key is case-insensitive (uppercased address maps to lowercase key)", () => {
    localStorage.setItem(
      "pipeline.mock.wallet.contract.0xabc123.balanceOf",
      JSON.stringify(99),
    );

    const { result } = renderHook(
      () =>
        useContractRead({
          address: "0xABC123", // uppercase — should still hit the lowercase key
          abi: testAbi,
          functionName: "balanceOf",
        }),
      { wrapper },
    );

    expect(result.current.data).toBe(99);
  });

  it("disables real wagmi read when mock is present", () => {
    localStorage.setItem(
      "pipeline.mock.wallet.contract.0xabc123.balanceOf",
      JSON.stringify("100"),
    );

    renderHook(
      () =>
        useContractRead({
          address: "0xabc123",
          abi: testAbi,
          functionName: "balanceOf",
        }),
      { wrapper },
    );

    const calls = mockUseReadContract.mock.calls as unknown as Array<
      [{ query?: { enabled?: boolean } }]
    >;
    const lastCall = calls.at(-1);
    if (lastCall) {
      expect(lastCall[0]?.query?.enabled).toBe(false);
    }
  });
});

describe("useContractRead — no mock", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseReadContract.mockClear();
  });

  it("delegates to wagmi useReadContract when no mock is set", () => {
    mockUseReadContract.mockReturnValue({
      data: 999n,
      isLoading: false,
      error: null,
    });

    const { result } = renderHook(
      () =>
        useContractRead({
          address: "0xabc123",
          abi: testAbi,
          functionName: "balanceOf",
        }),
      { wrapper },
    );

    expect(result.current.data).toBe(999n);
    expect(mockUseReadContract).toHaveBeenCalled();
  });
});
