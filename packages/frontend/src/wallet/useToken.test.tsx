import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { WalletProvider } from "./WalletProvider";
import { useToken } from "./useToken";

// ── Mock wagmi ────────────────────────────────────────────────────────────────

const mockRefetch = vi.fn();

const mockUseReadContract = vi.fn(() => ({
  data: undefined as unknown,
  isLoading: false,
  error: null,
  refetch: mockRefetch,
}));

const mockWriteContract = vi.fn();
const mockWagmiReset = vi.fn();

// Stable write contract return — avoids infinite re-renders.
const stableWriteContractState = {
  writeContract: mockWriteContract,
  data: undefined as string | undefined,
  isPending: false,
  isSuccess: false,
  error: null as Error | null,
  reset: mockWagmiReset,
};
const mockUseWriteContract = vi.fn(() => stableWriteContractState);

// useAccount — mutable so individual tests can switch connected/disconnected.
const mockUseAccount = vi.fn(() => ({
  address: undefined as `0x${string}` | undefined,
  isConnected: false,
}));

// Mock publicClient for gas estimation (used by useApproval internally).
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
    useAccount: () => mockUseAccount(),
    useChainId: vi.fn(() => 560048),
    useDisconnect: vi.fn(() => ({ disconnect: vi.fn() })),
    useReadContract: (...args: Parameters<typeof mockUseReadContract>) =>
      mockUseReadContract(...args),
    useWriteContract: () => mockUseWriteContract(),
    usePublicClient: () => mockUsePublicClient(),
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

// ── Mock ENV ──────────────────────────────────────────────────────────────────

const ZERO_ADDRESS =
  "0x0000000000000000000000000000000000000000" as `0x${string}`;
const TOKEN_ADDRESS =
  "0xaaaa000000000000000000000000000000000001" as `0x${string}`;
const SPENDER_ADDRESS =
  "0xbbbb000000000000000000000000000000000002" as `0x${string}`;
const WALLET_ADDRESS =
  "0xcccc000000000000000000000000000000000003" as `0x${string}`;

vi.mock("@/lib/env", () => ({
  ENV: {
    EVM_CHAIN_ID: 560048,
    EVM_RPC_URL: "https://ethereum-hoodi-rpc.publicnode.com",
    DEPOSIT_MANAGER_ADDRESS: "0x0000000000000000000000000000000000000000",
    WALLETCONNECT_PROJECT_ID: "replace-me",
  },
}));

// ── Spy on fetch (assert zero RPC calls in mock mode) ─────────────────────────

const fetchSpy = vi.spyOn(globalThis, "fetch");

function wrapper({ children }: { children: React.ReactNode }) {
  return <WalletProvider>{children}</WalletProvider>;
}

function setConnectedWallet() {
  mockUseAccount.mockReturnValue({
    address: WALLET_ADDRESS,
    isConnected: true,
  });
}

function setDisconnectedWallet() {
  mockUseAccount.mockReturnValue({ address: undefined, isConnected: false });
}

// ── Helper: build mock keys ───────────────────────────────────────────────────

function decimalsKey(token: string) {
  return `pipeline.mock.wallet.contract.${token.toLowerCase()}.decimals`;
}
function symbolKey(token: string) {
  return `pipeline.mock.wallet.contract.${token.toLowerCase()}.symbol`;
}
function balanceKey(token: string) {
  return `pipeline.mock.wallet.balance.${token.toLowerCase()}`;
}
function allowanceKey(token: string, spender: string) {
  return `pipeline.mock.wallet.allowance.${token.toLowerCase()}.${spender.toLowerCase()}`;
}
function approveKey(token: string) {
  return `pipeline.mock.wallet.contract.${token.toLowerCase()}.approve`;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useToken — metadata mock keys", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseReadContract.mockClear();
    fetchSpy.mockClear();
    setConnectedWallet();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("returns decimals and symbol from mock keys", () => {
    localStorage.setItem(decimalsKey(TOKEN_ADDRESS), "6");
    localStorage.setItem(symbolKey(TOKEN_ADDRESS), "USDC");

    const { result } = renderHook(() => useToken({ token: TOKEN_ADDRESS }), {
      wrapper,
    });

    expect(result.current.decimals).toBe(6);
    expect(result.current.symbol).toBe("USDC");
  });

  it("disables the decimals and symbol useReadContract calls when mock keys are set", () => {
    localStorage.setItem(decimalsKey(TOKEN_ADDRESS), "6");
    localStorage.setItem(symbolKey(TOKEN_ADDRESS), "USDC");

    renderHook(() => useToken({ token: TOKEN_ADDRESS }), { wrapper });

    const calls = mockUseReadContract.mock.calls as unknown as Array<
      [{ functionName?: string; query?: { enabled?: boolean } }]
    >;
    const decimalsCalls = calls.filter(
      (call) => call[0]?.functionName === "decimals",
    );
    const symbolCalls = calls.filter(
      (call) => call[0]?.functionName === "symbol",
    );
    expect(decimalsCalls.length).toBeGreaterThan(0);
    expect(symbolCalls.length).toBeGreaterThan(0);
    for (const call of decimalsCalls) {
      expect(call[0]?.query?.enabled).toBe(false);
    }
    for (const call of symbolCalls) {
      expect(call[0]?.query?.enabled).toBe(false);
    }
  });
});

describe("useToken — balance mock key", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseReadContract.mockClear();
    fetchSpy.mockClear();
    setConnectedWallet();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("returns raw balance from mock key", () => {
    localStorage.setItem(balanceKey(TOKEN_ADDRESS), "1000000000");

    const { result } = renderHook(() => useToken({ token: TOKEN_ADDRESS }), {
      wrapper,
    });

    expect(result.current.balance).toBe(1_000_000_000n);
  });

  it("returns formattedBalance as USD currency string when both balance and decimals are mocked", () => {
    localStorage.setItem(decimalsKey(TOKEN_ADDRESS), "6");
    localStorage.setItem(symbolKey(TOKEN_ADDRESS), "USDC");
    localStorage.setItem(balanceKey(TOKEN_ADDRESS), "1000000000");

    const { result } = renderHook(() => useToken({ token: TOKEN_ADDRESS }), {
      wrapper,
    });

    expect(result.current.formattedBalance).toBe("$1,000.00");
  });

  it("returns formattedBalance undefined while decimals is not yet available", () => {
    // Balance mocked but decimals not mocked and wagmi not returning anything
    localStorage.setItem(balanceKey(TOKEN_ADDRESS), "1000000000");

    const { result } = renderHook(() => useToken({ token: TOKEN_ADDRESS }), {
      wrapper,
    });

    // decimals returns undefined from wagmi mock (default), so formattedBalance is undefined
    expect(result.current.formattedBalance).toBeUndefined();
  });
});

describe("useToken — real RPC happy path", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseReadContract.mockClear();
    fetchSpy.mockClear();
    setConnectedWallet();
  });

  afterEach(() => {
    localStorage.clear();
    mockUseReadContract.mockReset();
    mockUseReadContract.mockImplementation(() => ({
      data: undefined as unknown,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    }));
  });

  it("surfaces decimals, symbol, balance, and formattedBalance from wagmi reads", () => {
    // Return different values based on functionName
    mockUseReadContract.mockImplementation((...rawArgs: unknown[]) => {
      const args = rawArgs[0] as { functionName?: string };
      if (args.functionName === "decimals")
        return { data: 6, isLoading: false, error: null, refetch: mockRefetch };
      if (args.functionName === "symbol")
        return {
          data: "USDC",
          isLoading: false,
          error: null,
          refetch: mockRefetch,
        };
      if (args.functionName === "balanceOf")
        return {
          data: 500_000_000n,
          isLoading: false,
          error: null,
          refetch: mockRefetch,
        };
      return {
        data: undefined,
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      };
    });

    const { result } = renderHook(() => useToken({ token: TOKEN_ADDRESS }), {
      wrapper,
    });

    expect(result.current.decimals).toBe(6);
    expect(result.current.symbol).toBe("USDC");
    expect(result.current.balance).toBe(500_000_000n);
    expect(result.current.formattedBalance).toBe("$500.00");
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });
});

describe("useToken — spender omitted branch", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseReadContract.mockClear();
    setConnectedWallet();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("returns undefined for all approval fields when spender is not provided", () => {
    const { result } = renderHook(() => useToken({ token: TOKEN_ADDRESS }), {
      wrapper,
    });

    expect(result.current.allowance).toBeUndefined();
    expect(result.current.isSufficient).toBeUndefined();
    expect(result.current.approve).toBeUndefined();
    expect(result.current.approveData).toBeUndefined();
    expect(result.current.refetchAllowance).toBeUndefined();
  });

  it("sets isApprovePending and isApproveSuccess to false when spender is omitted", () => {
    const { result } = renderHook(() => useToken({ token: TOKEN_ADDRESS }), {
      wrapper,
    });

    expect(result.current.isApprovePending).toBe(false);
    expect(result.current.isApproveSuccess).toBe(false);
  });

  it("disables the allowance read when spender is omitted (zero-address spender)", () => {
    renderHook(() => useToken({ token: TOKEN_ADDRESS }), { wrapper });

    const calls = mockUseReadContract.mock.calls as unknown as Array<
      [{ functionName?: string; query?: { enabled?: boolean } }]
    >;
    const allowanceCalls = calls.filter(
      (call) => call[0]?.functionName === "allowance",
    );
    // allowance read should be disabled (ZERO_ADDRESS spender short-circuits)
    for (const call of allowanceCalls) {
      expect(call[0]?.query?.enabled).toBe(false);
    }
  });
});

describe("useToken — spender provided (approval delegation)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    mockUseReadContract.mockClear();
    fetchSpy.mockClear();
    setConnectedWallet();
  });

  afterEach(() => {
    localStorage.clear();
    stableWriteContractState.isSuccess = false;
    stableWriteContractState.data = undefined;
  });

  it("delegates approve mock key through the approval branch", async () => {
    const mockData = { hash: "0xapprovetx" };
    localStorage.setItem(
      allowanceKey(TOKEN_ADDRESS, SPENDER_ADDRESS),
      "500000",
    );
    localStorage.setItem(approveKey(TOKEN_ADDRESS), JSON.stringify(mockData));

    const { result } = renderHook(
      () => useToken({ token: TOKEN_ADDRESS, spender: SPENDER_ADDRESS }),
      { wrapper },
    );

    expect(result.current.allowance).toBe(500_000n);
    expect(typeof result.current.approve).toBe("function");

    act(() => {
      result.current.approve!(123n);
    });

    await waitFor(() => {
      expect(result.current.isApproveSuccess).toBe(true);
    });

    expect(result.current.approveData).toEqual(mockData);
    expect(mockWriteContract).not.toHaveBeenCalled();
  });

  it("exposes isSufficient when spender is provided", () => {
    mockUseReadContract.mockImplementation((...rawArgs: unknown[]) => {
      const args = rawArgs[0] as { functionName?: string };
      if (args.functionName === "allowance")
        return {
          data: 100n,
          isLoading: false,
          error: null,
          refetch: mockRefetch,
        };
      return {
        data: undefined,
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      };
    });

    const { result } = renderHook(
      () => useToken({ token: TOKEN_ADDRESS, spender: SPENDER_ADDRESS }),
      { wrapper },
    );

    expect(typeof result.current.isSufficient).toBe("function");
    expect(result.current.isSufficient!(100n)).toBe(true);
    expect(result.current.isSufficient!(101n)).toBe(false);
  });
});

describe("useToken — zero-address token short-circuit", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseReadContract.mockClear();
    setConnectedWallet();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("disables all reads when token is zero address", () => {
    const { result } = renderHook(() => useToken({ token: ZERO_ADDRESS }), {
      wrapper,
    });

    expect(result.current.decimals).toBeUndefined();
    expect(result.current.symbol).toBeUndefined();
    expect(result.current.balance).toBeUndefined();
    expect(result.current.formattedBalance).toBeUndefined();

    const calls = mockUseReadContract.mock.calls as unknown as Array<
      [{ query?: { enabled?: boolean } }]
    >;
    for (const call of calls) {
      expect(call[0]?.query?.enabled).toBe(false);
    }
  });
});

describe("useToken — disconnected wallet", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseReadContract.mockClear();
    setDisconnectedWallet();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("returns balance undefined when wallet is disconnected", () => {
    const { result } = renderHook(() => useToken({ token: TOKEN_ADDRESS }), {
      wrapper,
    });

    expect(result.current.balance).toBeUndefined();
  });

  it("disables balanceOf read when wallet is disconnected", () => {
    renderHook(() => useToken({ token: TOKEN_ADDRESS }), { wrapper });

    const calls = mockUseReadContract.mock.calls as unknown as Array<
      [{ functionName?: string; query?: { enabled?: boolean } }]
    >;
    const balanceCalls = calls.filter(
      (call) => call[0]?.functionName === "balanceOf",
    );
    for (const call of balanceCalls) {
      expect(call[0]?.query?.enabled).toBe(false);
    }
  });

  it("still fires metadata reads when wallet is disconnected", () => {
    renderHook(() => useToken({ token: TOKEN_ADDRESS }), { wrapper });

    const calls = mockUseReadContract.mock.calls as unknown as Array<
      [{ functionName?: string; query?: { enabled?: boolean } }]
    >;
    // Metadata reads are not gated on wallet connection
    const decimalsCalls = calls.filter(
      (call) => call[0]?.functionName === "decimals",
    );
    expect(decimalsCalls.length).toBeGreaterThan(0);
    const lastDecimalsCall = decimalsCalls[decimalsCalls.length - 1]!;
    // enabled=true because no mock set and token is not zero
    expect(lastDecimalsCall[0]?.query?.enabled).toBe(true);
  });
});

describe("useToken — aggregated isLoading", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseReadContract.mockClear();
    setConnectedWallet();
  });

  afterEach(() => {
    localStorage.clear();
    mockUseReadContract.mockReset();
    mockUseReadContract.mockImplementation(() => ({
      data: undefined as unknown,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    }));
  });

  it("surfaces isLoading true when decimals read is in flight", () => {
    mockUseReadContract.mockImplementation((...rawArgs: unknown[]) => {
      const args = rawArgs[0] as { functionName?: string };
      if (args.functionName === "decimals")
        return {
          data: undefined,
          isLoading: true,
          error: null,
          refetch: mockRefetch,
        };
      return {
        data: undefined,
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      };
    });

    const { result } = renderHook(() => useToken({ token: TOKEN_ADDRESS }), {
      wrapper,
    });

    expect(result.current.isLoading).toBe(true);
  });

  it("surfaces isLoading false when all reads are done", () => {
    mockUseReadContract.mockImplementation(() => ({
      data: undefined as unknown,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    }));

    const { result } = renderHook(() => useToken({ token: TOKEN_ADDRESS }), {
      wrapper,
    });

    expect(result.current.isLoading).toBe(false);
  });
});

describe("useToken — error aggregation", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseReadContract.mockClear();
    setConnectedWallet();
  });

  afterEach(() => {
    localStorage.clear();
    mockUseReadContract.mockReset();
    mockUseReadContract.mockImplementation(() => ({
      data: undefined as unknown,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    }));
  });

  it("surfaces useApproval error when spender is provided", () => {
    const testError = new Error("allowance RPC failed");
    mockUseReadContract.mockImplementation((...rawArgs: unknown[]) => {
      const args = rawArgs[0] as { functionName?: string };
      if (args.functionName === "allowance")
        return {
          data: undefined,
          isLoading: false,
          error: testError,
          refetch: mockRefetch,
        } as unknown as ReturnType<typeof mockUseReadContract>;
      return {
        data: undefined,
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      };
    });

    const { result } = renderHook(
      () => useToken({ token: TOKEN_ADDRESS, spender: SPENDER_ADDRESS }),
      { wrapper },
    );

    expect(result.current.error).toBe(testError);
  });

  it("does not surface approval error when spender is omitted", () => {
    // Even though allowance read might error internally, useToken masks it
    // when spender is omitted (zero-address spender won't fire, but we test
    // the gating logic at the error aggregation level).
    const { result } = renderHook(() => useToken({ token: TOKEN_ADDRESS }), {
      wrapper,
    });

    // No errors from metadata reads in default mock; approval error masked
    expect(result.current.error).toBeNull();
  });
});

describe("useToken — no RPC in full mock mode (lock-in guard)", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchSpy.mockClear();
    setConnectedWallet();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("never calls fetch when all mock keys are set", async () => {
    localStorage.setItem(decimalsKey(TOKEN_ADDRESS), "6");
    localStorage.setItem(symbolKey(TOKEN_ADDRESS), "USDC");
    localStorage.setItem(balanceKey(TOKEN_ADDRESS), "1000000000");
    localStorage.setItem(
      allowanceKey(TOKEN_ADDRESS, SPENDER_ADDRESS),
      "500000",
    );
    localStorage.setItem(
      approveKey(TOKEN_ADDRESS),
      JSON.stringify({ hash: "0xmocked" }),
    );

    const { result } = renderHook(
      () => useToken({ token: TOKEN_ADDRESS, spender: SPENDER_ADDRESS }),
      { wrapper },
    );

    act(() => {
      result.current.approve!(100n);
    });

    await waitFor(() => {
      expect(result.current.isApproveSuccess).toBe(true);
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("useToken — formattedBalance undefined while metadata loading", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseReadContract.mockClear();
    setConnectedWallet();
  });

  afterEach(() => {
    localStorage.clear();
    mockUseReadContract.mockReset();
    mockUseReadContract.mockImplementation(() => ({
      data: undefined as unknown,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    }));
  });

  it("returns formattedBalance undefined when balance is mocked but decimals is still loading", () => {
    localStorage.setItem(balanceKey(TOKEN_ADDRESS), "1000000000");

    // decimals read is in flight (isLoading: true, no data)
    mockUseReadContract.mockImplementation((...rawArgs: unknown[]) => {
      const args = rawArgs[0] as { functionName?: string };
      if (args.functionName === "decimals")
        return {
          data: undefined,
          isLoading: true,
          error: null,
          refetch: mockRefetch,
        };
      return {
        data: undefined,
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      };
    });

    const { result } = renderHook(() => useToken({ token: TOKEN_ADDRESS }), {
      wrapper,
    });

    expect(result.current.balance).toBe(1_000_000_000n);
    expect(result.current.decimals).toBeUndefined();
    expect(result.current.formattedBalance).toBeUndefined();
  });

  it("returns formattedBalance undefined when balance is loading", () => {
    localStorage.setItem(decimalsKey(TOKEN_ADDRESS), "6");
    // Balance still loading from wagmi (no mock set)

    mockUseReadContract.mockImplementation((...rawArgs: unknown[]) => {
      const args = rawArgs[0] as { functionName?: string };
      if (args.functionName === "balanceOf")
        return {
          data: undefined,
          isLoading: true,
          error: null,
          refetch: mockRefetch,
        };
      return {
        data: undefined,
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      };
    });

    const { result } = renderHook(() => useToken({ token: TOKEN_ADDRESS }), {
      wrapper,
    });

    expect(result.current.balance).toBeUndefined();
    expect(result.current.formattedBalance).toBeUndefined();
  });
});

describe("useToken — refetchBalance is exposed", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseReadContract.mockClear();
    mockRefetch.mockClear();
    setConnectedWallet();
  });

  afterEach(() => {
    localStorage.clear();
    mockUseReadContract.mockReset();
    mockUseReadContract.mockImplementation(() => ({
      data: undefined as unknown,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    }));
  });

  it("exposes refetchBalance and delegates to wagmi refetch", () => {
    const { result } = renderHook(() => useToken({ token: TOKEN_ADDRESS }), {
      wrapper,
    });

    expect(typeof result.current.refetchBalance).toBe("function");

    act(() => {
      result.current.refetchBalance();
    });

    expect(mockRefetch).toHaveBeenCalled();
  });
});

describe("useToken — balanceOf uses wallet address as arg", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseReadContract.mockClear();
    setConnectedWallet();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("passes connected wallet address as the owner arg to balanceOf", () => {
    renderHook(() => useToken({ token: TOKEN_ADDRESS }), { wrapper });

    const calls = mockUseReadContract.mock.calls as unknown as Array<
      [{ functionName?: string; args?: unknown[] }]
    >;
    const balanceCalls = calls.filter(
      (call) => call[0]?.functionName === "balanceOf",
    );
    expect(balanceCalls.length).toBeGreaterThan(0);
    const lastCall = balanceCalls[balanceCalls.length - 1]!;
    expect(lastCall[0]?.args).toEqual([WALLET_ADDRESS]);
  });
});
