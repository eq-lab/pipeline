import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { WalletProvider } from "./WalletProvider";
import { useApproval } from "./useApproval";
import { erc20Abi } from "./abis/erc20";

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

// Stable write contract return — new object identity on every call causes
// infinite re-renders in useSyncExternalStore + useWriteContract chains.
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

const mockEnv = vi.hoisted(() => ({
  EVM_CHAIN_ID: 560048,
  EVM_RPC_URL: "https://ethereum-hoodi-rpc.publicnode.com",
  USDC_ADDRESS: "0x0000000000000000000000000000000000000000" as `0x${string}`,
  DEPOSIT_MANAGER_ADDRESS:
    "0x0000000000000000000000000000000000000000" as `0x${string}`,
  WALLETCONNECT_PROJECT_ID: "replace-me",
}));

vi.mock("@/lib/env", () => ({
  ENV: mockEnv,
  withEnvOverride: (overrides: Record<string, unknown>, fn: () => void) => {
    const original = { ...mockEnv };
    Object.assign(mockEnv, overrides);
    try {
      fn();
    } finally {
      Object.assign(mockEnv, original);
    }
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useApproval — allowance mock key returns parsed bigint", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseReadContract.mockClear();
    mockRefetch.mockClear();
    fetchSpy.mockClear();
    setDisconnectedWallet();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("returns parsed bigint from mock allowance key", () => {
    localStorage.setItem(
      `pipeline.mock.wallet.allowance.${TOKEN_ADDRESS.toLowerCase()}.${SPENDER_ADDRESS.toLowerCase()}`,
      "1000000",
    );

    setConnectedWallet();

    const { result } = renderHook(
      () => useApproval({ token: TOKEN_ADDRESS, spender: SPENDER_ADDRESS }),
      { wrapper },
    );

    expect(result.current.allowance).toBe(1_000_000n);

    // Read should be disabled when mock key is present
    const calls = mockUseReadContract.mock.calls as unknown as Array<
      [{ query?: { enabled?: boolean } }]
    >;
    for (const call of calls) {
      expect(call[0]?.query?.enabled).toBe(false);
    }
  });

  it("allowance mock key is case-insensitive on token and spender", () => {
    // Mock key with lowercase; hook called with mixed-case addresses
    const mixedToken =
      "0xAaAa000000000000000000000000000000000001" as `0x${string}`;
    const mixedSpender =
      "0xBbBb000000000000000000000000000000000002" as `0x${string}`;

    localStorage.setItem(
      `pipeline.mock.wallet.allowance.${TOKEN_ADDRESS.toLowerCase()}.${SPENDER_ADDRESS.toLowerCase()}`,
      "999",
    );

    setConnectedWallet();

    const { result } = renderHook(
      () => useApproval({ token: mixedToken, spender: mixedSpender }),
      { wrapper },
    );

    expect(result.current.allowance).toBe(999n);
  });
});

describe("useApproval — real RPC path", () => {
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

  it("returns wagmi data on real RPC path with connected wallet and non-zero addresses", () => {
    mockUseReadContract.mockImplementation(() => ({
      data: 500n,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    }));

    const { result } = renderHook(
      () => useApproval({ token: TOKEN_ADDRESS, spender: SPENDER_ADDRESS }),
      { wrapper },
    );

    expect(result.current.allowance).toBe(500n);
    expect(result.current.isLoading).toBe(false);

    // Verify the call had the right args
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
    const allowanceCalls = calls.filter(
      (call) => call[0]?.functionName === "allowance",
    );
    expect(allowanceCalls.length).toBeGreaterThan(0);
    const lastCall = allowanceCalls[allowanceCalls.length - 1]!;
    expect(lastCall[0]?.query?.enabled).toBe(true);
    expect(lastCall[0]?.args).toEqual([WALLET_ADDRESS, SPENDER_ADDRESS]);
  });

  it("disables read when wallet is disconnected", () => {
    setDisconnectedWallet();

    const { result } = renderHook(
      () => useApproval({ token: TOKEN_ADDRESS, spender: SPENDER_ADDRESS }),
      { wrapper },
    );

    expect(result.current.allowance).toBeUndefined();

    const calls = mockUseReadContract.mock.calls as unknown as Array<
      [{ query?: { enabled?: boolean } }]
    >;
    for (const call of calls) {
      expect(call[0]?.query?.enabled).toBe(false);
    }
  });

  it("disables read when token is zero address", () => {
    const { result } = renderHook(
      () => useApproval({ token: ZERO_ADDRESS, spender: SPENDER_ADDRESS }),
      { wrapper },
    );

    expect(result.current.allowance).toBeUndefined();

    const calls = mockUseReadContract.mock.calls as unknown as Array<
      [{ query?: { enabled?: boolean } }]
    >;
    for (const call of calls) {
      expect(call[0]?.query?.enabled).toBe(false);
    }
  });

  it("disables read when spender is zero address", () => {
    const { result } = renderHook(
      () => useApproval({ token: TOKEN_ADDRESS, spender: ZERO_ADDRESS }),
      { wrapper },
    );

    expect(result.current.allowance).toBeUndefined();

    const calls = mockUseReadContract.mock.calls as unknown as Array<
      [{ query?: { enabled?: boolean } }]
    >;
    for (const call of calls) {
      expect(call[0]?.query?.enabled).toBe(false);
    }
  });
});

describe("useApproval — isSufficient semantics", () => {
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

  it("returns correct boolean comparisons when allowance is set", () => {
    mockUseReadContract.mockImplementation(() => ({
      data: 100n,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    }));

    const { result } = renderHook(
      () => useApproval({ token: TOKEN_ADDRESS, spender: SPENDER_ADDRESS }),
      { wrapper },
    );

    expect(result.current.isSufficient(99n)).toBe(true);
    expect(result.current.isSufficient(100n)).toBe(true);
    expect(result.current.isSufficient(101n)).toBe(false);
  });

  it("returns false for any amount when allowance is undefined", () => {
    setDisconnectedWallet();

    const { result } = renderHook(
      () => useApproval({ token: TOKEN_ADDRESS, spender: SPENDER_ADDRESS }),
      { wrapper },
    );

    expect(result.current.isSufficient(0n)).toBe(false);
    expect(result.current.isSufficient(100n)).toBe(false);
  });
});

describe("useApproval — approve args pass-through (no mock, non-zero, connected)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    mockUseWriteContract.mockClear();
    mockUseReadContract.mockClear();
    setConnectedWallet();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("calls wagmi writeContract with correct args", () => {
    const { result } = renderHook(
      () => useApproval({ token: TOKEN_ADDRESS, spender: SPENDER_ADDRESS }),
      { wrapper },
    );

    act(() => {
      result.current.approve(123n);
    });

    expect(mockWriteContract).toHaveBeenCalledOnce();
    expect(mockWriteContract).toHaveBeenCalledWith(
      expect.objectContaining({
        abi: erc20Abi,
        address: TOKEN_ADDRESS,
        functionName: "approve",
        args: [SPENDER_ADDRESS, 123n],
      }),
    );
  });
});

describe("useApproval — approve mock key bypasses RPC", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    fetchSpy.mockClear();
    setConnectedWallet();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("returns mocked data and does NOT call writeContract", async () => {
    const mockData = { hash: "0xabc" };
    localStorage.setItem(
      `pipeline.mock.wallet.contract.${TOKEN_ADDRESS.toLowerCase()}.approve`,
      JSON.stringify(mockData),
    );

    const { result } = renderHook(
      () => useApproval({ token: TOKEN_ADDRESS, spender: SPENDER_ADDRESS }),
      { wrapper },
    );

    act(() => {
      result.current.approve(100n);
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(mockData);
    expect(mockWriteContract).not.toHaveBeenCalled();
  });

  it("isPending flips true initially then settles to isSuccess", async () => {
    const mockData = { hash: "0xabc" };
    localStorage.setItem(
      `pipeline.mock.wallet.contract.${TOKEN_ADDRESS.toLowerCase()}.approve`,
      JSON.stringify(mockData),
    );

    const { result } = renderHook(
      () => useApproval({ token: TOKEN_ADDRESS, spender: SPENDER_ADDRESS }),
      { wrapper },
    );

    act(() => {
      result.current.approve(100n);
    });

    expect(result.current.isPending).toBe(true);

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
      expect(result.current.isPending).toBe(false);
    });
  });
});

describe("useApproval — approve error paths", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    setDisconnectedWallet();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("surfaces Wallet not connected error when wallet is disconnected", () => {
    const { result } = renderHook(
      () => useApproval({ token: TOKEN_ADDRESS, spender: SPENDER_ADDRESS }),
      { wrapper },
    );

    act(() => {
      result.current.approve(100n);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toMatch(/Wallet not connected/i);
    expect(mockWriteContract).not.toHaveBeenCalled();
  });

  it("surfaces Token not configured error when token is zero address", () => {
    setConnectedWallet();

    const { result } = renderHook(
      () => useApproval({ token: ZERO_ADDRESS, spender: SPENDER_ADDRESS }),
      { wrapper },
    );

    act(() => {
      result.current.approve(100n);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toMatch(/Token not configured/i);
    expect(mockWriteContract).not.toHaveBeenCalled();
  });

  it("surfaces Spender not configured error when spender is zero address", () => {
    setConnectedWallet();

    const { result } = renderHook(
      () => useApproval({ token: TOKEN_ADDRESS, spender: ZERO_ADDRESS }),
      { wrapper },
    );

    act(() => {
      result.current.approve(100n);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toMatch(/Spender not configured/i);
    expect(mockWriteContract).not.toHaveBeenCalled();
  });
});

describe("useApproval — auto-refetch after successful approve (real path)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseReadContract.mockClear();
    mockRefetch.mockClear();
    mockWriteContract.mockClear();
    mockUseWriteContract.mockClear();
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
    // Reset write contract state
    stableWriteContractState.isSuccess = false;
    stableWriteContractState.data = undefined;
  });

  it("calls refetch when wagmi isSuccess becomes true", async () => {
    mockUseReadContract.mockImplementation(() => ({
      data: 50n,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    }));

    const { rerender } = renderHook(
      () => useApproval({ token: TOKEN_ADDRESS, spender: SPENDER_ADDRESS }),
      { wrapper },
    );

    mockRefetch.mockClear();

    // Simulate wagmi isSuccess = true
    stableWriteContractState.isSuccess = true;
    stableWriteContractState.data = "0xhash123";

    rerender();

    await waitFor(() => {
      expect(mockRefetch).toHaveBeenCalled();
    });
  });
});

describe("useApproval — auto-refetch after mocked approve", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseReadContract.mockClear();
    mockRefetch.mockClear();
    mockWriteContract.mockClear();
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

  it("calls refetch after mocked approve settles", async () => {
    const mockData = { hash: "0xdeadbeef" };
    localStorage.setItem(
      `pipeline.mock.wallet.contract.${TOKEN_ADDRESS.toLowerCase()}.approve`,
      JSON.stringify(mockData),
    );

    const { result } = renderHook(
      () => useApproval({ token: TOKEN_ADDRESS, spender: SPENDER_ADDRESS }),
      { wrapper },
    );

    mockRefetch.mockClear();

    act(() => {
      result.current.approve(100n);
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    await waitFor(() => {
      expect(mockRefetch).toHaveBeenCalled();
    });
  });
});

describe("useApproval — manual refetch is exposed", () => {
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

  it("exposes refetch function that delegates to wagmi refetch", () => {
    const { result } = renderHook(
      () => useApproval({ token: TOKEN_ADDRESS, spender: SPENDER_ADDRESS }),
      { wrapper },
    );

    expect(typeof result.current.refetch).toBe("function");

    act(() => {
      result.current.refetch();
    });

    expect(mockRefetch).toHaveBeenCalled();
  });

  it("refetch is referentially stable across re-renders", () => {
    const { result, rerender } = renderHook(
      () => useApproval({ token: TOKEN_ADDRESS, spender: SPENDER_ADDRESS }),
      { wrapper },
    );

    const firstRefetch = result.current.refetch;

    rerender();

    // wagmi memoizes refetch; our hook passes it through directly.
    // Since we use the same mockRefetch function reference in all renders,
    // identity is stable.
    expect(result.current.refetch).toBe(firstRefetch);
  });
});

describe("useApproval — reset semantics", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWagmiReset.mockClear();
    setConnectedWallet();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("reset() clears mock state and calls wagmi reset", async () => {
    const mockData = { hash: "0xabc" };
    localStorage.setItem(
      `pipeline.mock.wallet.contract.${TOKEN_ADDRESS.toLowerCase()}.approve`,
      JSON.stringify(mockData),
    );

    const { result } = renderHook(
      () => useApproval({ token: TOKEN_ADDRESS, spender: SPENDER_ADDRESS }),
      { wrapper },
    );

    act(() => {
      result.current.approve(100n);
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.data).toBeUndefined();
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.isPending).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockWagmiReset).toHaveBeenCalled();
  });
});

describe("useApproval — no RPC in mock mode (lock-in guard)", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchSpy.mockClear();
    setConnectedWallet();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("never calls fetch when both allowance and approve mock keys are set", async () => {
    localStorage.setItem(
      `pipeline.mock.wallet.allowance.${TOKEN_ADDRESS.toLowerCase()}.${SPENDER_ADDRESS.toLowerCase()}`,
      "1000000",
    );
    localStorage.setItem(
      `pipeline.mock.wallet.contract.${TOKEN_ADDRESS.toLowerCase()}.approve`,
      JSON.stringify({ hash: "0xmocked" }),
    );

    const { result } = renderHook(
      () => useApproval({ token: TOKEN_ADDRESS, spender: SPENDER_ADDRESS }),
      { wrapper },
    );

    act(() => {
      result.current.approve(100n);
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
