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
    useWriteContract: vi.fn(() => ({
      writeContract: vi.fn(),
      data: undefined,
      isPending: false,
      isSuccess: false,
      error: null,
      reset: vi.fn(),
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

vi.mock("./config", () => ({
  wagmiConfig: {},
  wagmiAdapter: {},
}));

// ── Mock useDepositManagerAddresses ───────────────────────────────────────────

const mockUseDepositManagerAddresses = vi.fn(() => ({
  plusd: "0xAAAA000000000000000000000000000000000001" as `0x${string}`,
  usdc: "0xBBBB000000000000000000000000000000000002" as `0x${string}`,
  isLoading: false,
  error: null,
}));

vi.mock("./useDepositManager", () => ({
  useDepositManagerAddresses: () => mockUseDepositManagerAddresses(),
  useDepositManagerMinDeposit: vi.fn(() => ({
    minDeposit: undefined,
    isLoading: false,
    error: null,
  })),
  useRequestDeposit: vi.fn(() => ({
    write: vi.fn(),
    data: undefined,
    isPending: false,
    isSuccess: false,
    error: null,
    reset: vi.fn(),
  })),
  useClaim: vi.fn(() => ({
    write: vi.fn(),
    data: undefined,
    isPending: false,
    isSuccess: false,
    error: null,
    reset: vi.fn(),
  })),
}));

// ── Spy on fetch to assert no RPC calls in mock mode ─────────────────────────

const fetchSpy = vi.spyOn(globalThis, "fetch");

const USDC_ADDRESS =
  "0xBBBB000000000000000000000000000000000002" as `0x${string}`;
const WALLET_ADDRESS =
  "0xabc0000000000000000000000000000000000000" as `0x${string}`;

function wrapper({ children }: { children: React.ReactNode }) {
  return <WalletProvider>{children}</WalletProvider>;
}

describe("useUsdcBalance — mock mode", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchSpy.mockClear();
    mockUseDepositManagerAddresses.mockReturnValue({
      plusd: "0xAAAA000000000000000000000000000000000001" as `0x${string}`,
      usdc: USDC_ADDRESS,
      isLoading: false,
      error: null,
    });
    mockUseAccount.mockReturnValue({
      address: WALLET_ADDRESS,
      isConnected: true,
    });
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

describe("useUsdcBalance — disconnected wallet", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseDepositManagerAddresses.mockReturnValue({
      plusd: "0xAAAA000000000000000000000000000000000001" as `0x${string}`,
      usdc: USDC_ADDRESS,
      isLoading: false,
      error: null,
    });
    mockUseAccount.mockReturnValue({
      address: undefined as unknown as `0x${string}`,
      isConnected: false,
    });
  });

  afterEach(() => {
    mockUseAccount.mockReturnValue({
      address: WALLET_ADDRESS,
      isConnected: true,
    });
  });

  it("returns undefined when no wallet is connected", () => {
    const { result } = renderHook(() => useUsdcBalance(), { wrapper });
    expect(result.current.data).toBeUndefined();
    expect(result.current.formatted).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });
});

describe("useUsdcBalance — DepositManager not configured", () => {
  beforeEach(() => {
    localStorage.clear();
    // Manager returns no usdc address (not configured)
    mockUseDepositManagerAddresses.mockReturnValue({
      plusd: undefined,
      usdc: undefined,
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof mockUseDepositManagerAddresses>);
    mockUseAccount.mockReturnValue({
      address: WALLET_ADDRESS,
      isConnected: true,
    });
  });

  afterEach(() => {
    mockUseAccount.mockReturnValue({
      address: WALLET_ADDRESS,
      isConnected: true,
    });
    mockUseDepositManagerAddresses.mockReturnValue({
      plusd: "0xAAAA000000000000000000000000000000000001" as `0x${string}`,
      usdc: USDC_ADDRESS,
      isLoading: false,
      error: null,
    });
  });

  it("returns undefined when DepositManager usdc() is not configured", () => {
    const { result } = renderHook(() => useUsdcBalance(), { wrapper });
    expect(result.current.data).toBeUndefined();
    expect(result.current.formatted).toBeUndefined();
    expect(result.current.isLoading).toBe(false);

    // query.enabled should be false — no RPC for USDC balance
    const calls = mockUseReadContract.mock.calls as unknown as Array<
      [{ query?: { enabled?: boolean } }]
    >;
    const lastCall = calls.at(-1);
    if (lastCall) {
      expect(lastCall[0]?.query?.enabled).toBe(false);
    }
  });
});

describe("useUsdcBalance — usdc() not yet resolved", () => {
  beforeEach(() => {
    localStorage.clear();
    // Manager is still loading the usdc() view
    mockUseDepositManagerAddresses.mockReturnValue({
      plusd: undefined,
      usdc: undefined,
      isLoading: true,
      error: null,
    } as unknown as ReturnType<typeof mockUseDepositManagerAddresses>);
    mockUseAccount.mockReturnValue({
      address: WALLET_ADDRESS,
      isConnected: true,
    });
  });

  afterEach(() => {
    mockUseAccount.mockReturnValue({
      address: WALLET_ADDRESS,
      isConnected: true,
    });
    mockUseDepositManagerAddresses.mockReturnValue({
      plusd: "0xAAAA000000000000000000000000000000000001" as `0x${string}`,
      usdc: USDC_ADDRESS,
      isLoading: false,
      error: null,
    });
  });

  it("returns isLoading:true and data:undefined while usdc() is in flight", () => {
    const { result } = renderHook(() => useUsdcBalance(), { wrapper });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
    expect(result.current.formatted).toBeUndefined();

    // query.enabled should be false while not yet resolved
    const calls = mockUseReadContract.mock.calls as unknown as Array<
      [{ query?: { enabled?: boolean } }]
    >;
    const lastCall = calls.at(-1);
    if (lastCall) {
      expect(lastCall[0]?.query?.enabled).toBe(false);
    }
  });
});

describe("useUsdcBalance — real RPC path (happy case)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseDepositManagerAddresses.mockReturnValue({
      plusd: "0xAAAA000000000000000000000000000000000001" as `0x${string}`,
      usdc: USDC_ADDRESS,
      isLoading: false,
      error: null,
    });
    mockUseAccount.mockReturnValue({
      address: WALLET_ADDRESS,
      isConnected: true,
    });
    mockUseReadContract.mockReturnValue({
      data: 500_000_000n,
      isLoading: false,
      error: null,
    });
  });

  afterEach(() => {
    mockUseReadContract.mockReturnValue({
      data: undefined as bigint | undefined,
      isLoading: false,
      error: null,
    });
    mockUseAccount.mockReturnValue({
      address: WALLET_ADDRESS,
      isConnected: true,
    });
    mockUseDepositManagerAddresses.mockReturnValue({
      plusd: "0xAAAA000000000000000000000000000000000001" as `0x${string}`,
      usdc: USDC_ADDRESS,
      isLoading: false,
      error: null,
    });
  });

  it("calls useReadContract with the manager-derived USDC address and query.enabled:true", () => {
    renderHook(() => useUsdcBalance(), { wrapper });

    const calls = mockUseReadContract.mock.calls as unknown as Array<
      [
        {
          address?: string;
          functionName?: string;
          args?: unknown[];
          query?: { enabled?: boolean };
        },
      ]
    >;
    const balanceCalls = calls.filter(
      (call) => call[0]?.functionName === "balanceOf",
    );
    expect(balanceCalls.length).toBeGreaterThan(0);
    const lastBalanceCall = balanceCalls.at(-1)!;
    expect(lastBalanceCall[0]?.address).toBe(USDC_ADDRESS);
    expect(lastBalanceCall[0]?.args).toEqual([WALLET_ADDRESS]);
    expect(lastBalanceCall[0]?.query?.enabled).toBe(true);
  });

  it("returns data and formatted string from wagmi on real RPC path", () => {
    const { result } = renderHook(() => useUsdcBalance(), { wrapper });
    expect(result.current.data).toBe(500_000_000n);
    expect(result.current.formatted).toBe("$500.00");
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });
});

describe("useUsdcBalance — address change reactivity", () => {
  it("uses updated usdc address when manager resolves after initial undefined", () => {
    // Start with loading state
    mockUseDepositManagerAddresses.mockReturnValue({
      plusd: undefined,
      usdc: undefined,
      isLoading: true,
      error: null,
    } as unknown as ReturnType<typeof mockUseDepositManagerAddresses>);
    mockUseAccount.mockReturnValue({
      address: WALLET_ADDRESS,
      isConnected: true,
    });
    mockUseReadContract.mockReturnValue({
      data: undefined as bigint | undefined,
      isLoading: false,
      error: null,
    });

    const { result, rerender } = renderHook(() => useUsdcBalance(), {
      wrapper,
    });
    expect(result.current.isLoading).toBe(true);

    // Now the manager resolves with a real USDC address
    mockUseDepositManagerAddresses.mockReturnValue({
      plusd: "0xAAAA000000000000000000000000000000000001" as `0x${string}`,
      usdc: USDC_ADDRESS,
      isLoading: false,
      error: null,
    });
    mockUseReadContract.mockReturnValue({
      data: 250_000_000n,
      isLoading: false,
      error: null,
    });

    rerender();

    // After resolution, the USDC address should be used
    const calls = mockUseReadContract.mock.calls as unknown as Array<
      [
        {
          address?: string;
          functionName?: string;
          query?: { enabled?: boolean };
        },
      ]
    >;
    const lastBalanceCall = calls
      .filter((call) => call[0]?.functionName === "balanceOf")
      .at(-1);
    if (lastBalanceCall) {
      expect(lastBalanceCall[0]?.address).toBe(USDC_ADDRESS);
    }
  });
});
