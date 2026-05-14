import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import React from "react";
import { renderHook } from "@testing-library/react";
import { WalletProvider } from "./WalletProvider";
import { useUsdcBalance } from "./useWallet";

// ── Mock wagmi ────────────────────────────────────────────────────────────────

const mockUseAccount = vi.fn(() => ({
  address: "0xabc0000000000000000000000000000000000000" as `0x${string}`,
  isConnected: true,
}));

const mockUseReadContract = vi.fn(() => ({
  data: undefined as bigint | undefined,
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
    useAccount: () => mockUseAccount(),
    useChainId: vi.fn(() => 560048),
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

// ── Spy on fetch to assert no RPC calls in mock mode ─────────────────────────

const fetchSpy = vi.spyOn(globalThis, "fetch");

function wrapper({ children }: { children: React.ReactNode }) {
  return <WalletProvider>{children}</WalletProvider>;
}

describe("useUsdcBalance — mock mode", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchSpy.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns parsed bigint + formatted string from mock key", () => {
    localStorage.setItem("pipeline.mock.wallet.balance.usdc", "1000000000");
    const { result } = renderHook(() => useUsdcBalance(), { wrapper });

    expect(result.current.data).toBe(1_000_000_000n);
    expect(result.current.formatted).toBe("$1,000.00");
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("does NOT call fetch in mock mode (zero RPC calls)", () => {
    localStorage.setItem("pipeline.mock.wallet.balance.usdc", "500000000");
    renderHook(() => useUsdcBalance(), { wrapper });

    // fetch is the underlying transport — it should NOT be called when mocked
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("verifies wagmi useReadContract is disabled in mock mode", () => {
    localStorage.setItem("pipeline.mock.wallet.balance.usdc", "500000000");
    renderHook(() => useUsdcBalance(), { wrapper });

    // The `query.enabled` flag should be false when mock is set
    const calls = mockUseReadContract.mock.calls as unknown as Array<
      [{ query?: { enabled?: boolean } }]
    >;
    const lastCall = calls.at(-1);
    if (lastCall) {
      expect(lastCall[0]?.query?.enabled).toBe(false);
    }
  });
});

describe("useUsdcBalance — disconnected / zero address", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseAccount.mockReturnValue({
      address: undefined as unknown as `0x${string}`,
      isConnected: false,
    });
  });

  afterEach(() => {
    mockUseAccount.mockReturnValue({
      address: "0xabc0000000000000000000000000000000000000" as `0x${string}`,
      isConnected: true,
    });
  });

  it("returns undefined when no wallet is connected", () => {
    const { result } = renderHook(() => useUsdcBalance(), { wrapper });
    expect(result.current.data).toBeUndefined();
    expect(result.current.formatted).toBeUndefined();
  });
});

describe("useUsdcBalance — zero USDC address", () => {
  beforeEach(() => {
    localStorage.clear();
    // Default ENV.USDC_ADDRESS is the zero address, so the read is skipped
  });

  it("returns undefined when USDC_ADDRESS is zero (read skipped)", () => {
    // The ENV defaults to the zero address in test, so the hook skips the read
    const { result } = renderHook(() => useUsdcBalance(), { wrapper });
    // Even with a connected wallet mock, zero address → undefined
    expect(result.current.data).toBeUndefined();
  });
});
