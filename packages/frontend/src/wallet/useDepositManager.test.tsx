import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { WalletProvider } from "./WalletProvider";
import {
  useDepositManagerAddresses,
  useDepositManagerMinDeposit,
  useRequestDeposit,
  useClaim,
} from "./useDepositManager";

// ── Mock wagmi ────────────────────────────────────────────────────────────────

const mockUseReadContract = vi.fn(() => ({
  data: undefined as unknown,
  isLoading: false,
  error: null,
}));

const mockWriteContract = vi.fn();

// Stable write contract return — new object identity on every call causes
// infinite re-renders in useSyncExternalStore + useWriteContract chains.
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

vi.mock("./config", () => ({
  wagmiConfig: {},
  wagmiAdapter: {},
}));

// ── Mock ENV ──────────────────────────────────────────────────────────────────
// We mock the env module so tests can override DEPOSIT_MANAGER_ADDRESS.
// `mockEnv` must be declared via vi.hoisted so it's available in the
// vi.mock factory (which is hoisted to the top of the file by vitest).

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

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

// Helper: reset mockEnv to defaults
function resetEnv() {
  mockEnv.DEPOSIT_MANAGER_ADDRESS = ZERO_ADDRESS as `0x${string}`;
  mockEnv.USDC_ADDRESS = ZERO_ADDRESS as `0x${string}`;
}

// ── useDepositManagerAddresses ─────────────────────────────────────────────────

describe("useDepositManagerAddresses — named alias mocks", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseReadContract.mockClear();
    fetchSpy.mockClear();
    resetEnv();
  });

  afterEach(() => {
    localStorage.clear();
    resetEnv();
  });

  it("returns plusd and usdc from named alias keys", () => {
    localStorage.setItem(
      "pipeline.mock.wallet.contract.depositManager.plusd",
      "0xAAAA000000000000000000000000000000000001",
    );
    localStorage.setItem(
      "pipeline.mock.wallet.contract.depositManager.usdc",
      "0xBBBB000000000000000000000000000000000002",
    );

    const { result } = renderHook(() => useDepositManagerAddresses(), {
      wrapper,
    });

    expect(result.current.plusd).toBe(
      "0xAAAA000000000000000000000000000000000001",
    );
    expect(result.current.usdc).toBe(
      "0xBBBB000000000000000000000000000000000002",
    );
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("disables real read (query.enabled false) when named aliases are set", () => {
    localStorage.setItem(
      "pipeline.mock.wallet.contract.depositManager.plusd",
      "0xAAAA000000000000000000000000000000000001",
    );
    localStorage.setItem(
      "pipeline.mock.wallet.contract.depositManager.usdc",
      "0xBBBB000000000000000000000000000000000002",
    );

    renderHook(() => useDepositManagerAddresses(), { wrapper });

    // All useReadContract calls should have enabled=false
    const calls = mockUseReadContract.mock.calls as unknown as Array<
      [{ query?: { enabled?: boolean } }]
    >;
    for (const call of calls) {
      expect(call[0]?.query?.enabled).toBe(false);
    }
  });
});

describe("useDepositManagerAddresses — generic per-address mock", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseReadContract.mockClear();
    resetEnv();
  });

  afterEach(() => {
    localStorage.clear();
    resetEnv();
  });

  it("returns values from generic per-address keys when env is non-zero", () => {
    const dmAddr = "0xDDDD000000000000000000000000000000000003";
    mockEnv.DEPOSIT_MANAGER_ADDRESS = dmAddr as `0x${string}`;

    localStorage.setItem(
      `pipeline.mock.wallet.contract.${dmAddr.toLowerCase()}.plUsd`,
      "0xCCCC000000000000000000000000000000000004",
    );
    localStorage.setItem(
      `pipeline.mock.wallet.contract.${dmAddr.toLowerCase()}.usdc`,
      "0xDDDD000000000000000000000000000000000005",
    );

    const { result } = renderHook(() => useDepositManagerAddresses(), {
      wrapper,
    });

    expect(result.current.plusd).toBe(
      "0xCCCC000000000000000000000000000000000004",
    );
    expect(result.current.usdc).toBe(
      "0xDDDD000000000000000000000000000000000005",
    );
    expect(result.current.isLoading).toBe(false);
  });

  it("generic key works when env address has uppercase hex letters", () => {
    // Uppercase env address should still match lowercase mock key (lowercased internally)
    const dmAddrUpper = "0xAAAABBBBCCCCDDDDEEEEFFFF000000000000ABCD";
    const dmAddrLower = dmAddrUpper.toLowerCase();
    mockEnv.DEPOSIT_MANAGER_ADDRESS = dmAddrUpper as `0x${string}`;

    localStorage.setItem(
      `pipeline.mock.wallet.contract.${dmAddrLower}.plUsd`,
      "0xAAAA000000000000000000000000000000000001",
    );
    localStorage.setItem(
      `pipeline.mock.wallet.contract.${dmAddrLower}.usdc`,
      "0xBBBB000000000000000000000000000000000002",
    );

    const { result } = renderHook(() => useDepositManagerAddresses(), {
      wrapper,
    });

    expect(result.current.plusd).toBe(
      "0xAAAA000000000000000000000000000000000001",
    );
  });
});

describe("useDepositManagerAddresses — zero-address short-circuit", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseReadContract.mockClear();
    resetEnv();
  });

  it("returns undefined data without RPC when DM address is zero (default env)", () => {
    const { result } = renderHook(() => useDepositManagerAddresses(), {
      wrapper,
    });

    expect(result.current.plusd).toBeUndefined();
    expect(result.current.usdc).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();

    // All useReadContract calls should be disabled
    const calls = mockUseReadContract.mock.calls as unknown as Array<
      [{ query?: { enabled?: boolean } }]
    >;
    for (const call of calls) {
      expect(call[0]?.query?.enabled).toBe(false);
    }
  });
});

describe("useDepositManagerAddresses — caching options forwarded", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseReadContract.mockClear();
    resetEnv();
  });

  afterEach(() => {
    localStorage.clear();
    resetEnv();
  });

  it("forwards staleTime:Infinity and all refetch:false flags to useReadContract", () => {
    const dmAddr = "0xEEEE000000000000000000000000000000000006";
    mockEnv.DEPOSIT_MANAGER_ADDRESS = dmAddr as `0x${string}`;

    renderHook(() => useDepositManagerAddresses(), { wrapper });

    const calls = mockUseReadContract.mock.calls as unknown as Array<
      [
        {
          query?: {
            enabled?: boolean;
            staleTime?: number;
            gcTime?: number;
            refetchOnWindowFocus?: boolean;
            refetchOnReconnect?: boolean;
            refetchOnMount?: boolean;
            refetchInterval?: boolean | number;
          };
        },
      ]
    >;

    // Each call (plUsd + usdc) should have the caching flags
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      const q = call[0]?.query;
      if (q) {
        expect(q.staleTime).toBe(Infinity);
        expect(q.gcTime).toBe(Infinity);
        expect(q.refetchOnWindowFocus).toBe(false);
        expect(q.refetchOnReconnect).toBe(false);
        expect(q.refetchOnMount).toBe(false);
        expect(q.refetchInterval).toBe(false);
      }
    }
  });
});

// ── useRequestDeposit ─────────────────────────────────────────────────────────

describe("useRequestDeposit — args pass-through (no mock, non-zero address)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    mockUseWriteContract.mockClear();
    mockUseReadContract.mockClear();
    resetEnv();
  });

  afterEach(() => {
    localStorage.clear();
    resetEnv();
  });

  it("calls wagmi writeContract with correct args for non-zero DM address", () => {
    const dmAddr = "0xFFFF000000000000000000000000000000000007";
    mockEnv.DEPOSIT_MANAGER_ADDRESS = dmAddr as `0x${string}`;

    const { result } = renderHook(() => useRequestDeposit(), { wrapper });

    act(() => {
      result.current.write(123n);
    });

    expect(mockWriteContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "requestDeposit",
        address: dmAddr,
        args: [123n],
      }),
    );
  });
});

describe("useRequestDeposit — mock key bypasses RPC", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    fetchSpy.mockClear();
    resetEnv();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    resetEnv();
  });

  it("returns mocked data and does NOT call writeContract", async () => {
    const mockData = { hash: "0xabc", requestId: "42" };
    localStorage.setItem(
      "pipeline.mock.wallet.contract.depositManager.requestDeposit",
      JSON.stringify(mockData),
    );

    const { result } = renderHook(() => useRequestDeposit(), { wrapper });

    act(() => {
      result.current.write(123n);
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(mockData);
    expect(mockWriteContract).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("isPending flips true initially then settles to isSuccess", async () => {
    const mockData = { hash: "0xabc", requestId: "42" };
    localStorage.setItem(
      "pipeline.mock.wallet.contract.depositManager.requestDeposit",
      JSON.stringify(mockData),
    );

    const { result } = renderHook(() => useRequestDeposit(), { wrapper });

    act(() => {
      result.current.write(123n);
    });

    // The mock path sets isPending=true initially
    expect(result.current.isPending).toBe(true);

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
      expect(result.current.isPending).toBe(false);
    });
  });
});

describe("useRequestDeposit — zero-address disables", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    resetEnv();
  });

  it("sets error and does NOT call writeContract when DM address is zero", () => {
    // Default ENV has zero DM address
    const { result } = renderHook(() => useRequestDeposit(), { wrapper });

    act(() => {
      result.current.write(123n);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toMatch(
      /DepositManager not configured/,
    );
    expect(mockWriteContract).not.toHaveBeenCalled();
  });
});

describe("useRequestDeposit — reset semantics", () => {
  beforeEach(() => {
    localStorage.clear();
    resetEnv();
  });

  afterEach(() => {
    localStorage.clear();
    resetEnv();
  });

  it("reset() clears data and isSuccess in mock mode", async () => {
    const mockData = { hash: "0xabc", requestId: "42" };
    localStorage.setItem(
      "pipeline.mock.wallet.contract.depositManager.requestDeposit",
      JSON.stringify(mockData),
    );

    const { result } = renderHook(() => useRequestDeposit(), { wrapper });

    act(() => {
      result.current.write(123n);
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.data).toBeUndefined();
    expect(result.current.isSuccess).toBe(false);
  });
});

// ── useClaim ──────────────────────────────────────────────────────────────────

describe("useClaim — args pass-through (no mock, non-zero address)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    mockUseWriteContract.mockClear();
    resetEnv();
  });

  afterEach(() => {
    localStorage.clear();
    resetEnv();
  });

  it("calls wagmi writeContract with correct args for non-zero DM address", () => {
    const dmAddr = "0xFFFF000000000000000000000000000000000008";
    mockEnv.DEPOSIT_MANAGER_ADDRESS = dmAddr as `0x${string}`;

    const { result } = renderHook(() => useClaim(), { wrapper });

    act(() => {
      result.current.write(99n, "0xdeadbeef" as `0x${string}`);
    });

    expect(mockWriteContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "claim",
        address: dmAddr,
        args: [99n, "0xdeadbeef"],
      }),
    );
  });
});

describe("useClaim — mock key bypasses RPC", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    fetchSpy.mockClear();
    resetEnv();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    resetEnv();
  });

  it("returns mocked data and does NOT call writeContract or fetch", async () => {
    const mockData = { hash: "0xdef", amount: "1000000" };
    localStorage.setItem(
      "pipeline.mock.wallet.contract.depositManager.claim",
      JSON.stringify(mockData),
    );

    const { result } = renderHook(() => useClaim(), { wrapper });

    act(() => {
      result.current.write(99n, "0xdeadbeef" as `0x${string}`);
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(mockData);
    expect(mockWriteContract).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("useClaim — zero-address disables", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    resetEnv();
  });

  it("sets error and does NOT call writeContract when DM address is zero", () => {
    const { result } = renderHook(() => useClaim(), { wrapper });

    act(() => {
      result.current.write(99n, "0xdeadbeef" as `0x${string}`);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toMatch(
      /DepositManager not configured/,
    );
    expect(mockWriteContract).not.toHaveBeenCalled();
  });
});

describe("useClaim — reset semantics", () => {
  beforeEach(() => {
    localStorage.clear();
    resetEnv();
  });

  afterEach(() => {
    localStorage.clear();
    resetEnv();
  });

  it("reset() clears data and isSuccess in mock mode", async () => {
    const mockData = { hash: "0xdef", amount: "1000000" };
    localStorage.setItem(
      "pipeline.mock.wallet.contract.depositManager.claim",
      JSON.stringify(mockData),
    );

    const { result } = renderHook(() => useClaim(), { wrapper });

    act(() => {
      result.current.write(99n, "0xdeadbeef" as `0x${string}`);
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.data).toBeUndefined();
    expect(result.current.isSuccess).toBe(false);
  });
});

// ── useDepositManagerMinDeposit ────────────────────────────────────────────────

describe("useDepositManagerMinDeposit — named alias mock", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseReadContract.mockClear();
    fetchSpy.mockClear();
    resetEnv();
  });

  afterEach(() => {
    localStorage.clear();
    resetEnv();
  });

  it("returns parsed bigint from named alias and disables real read", () => {
    localStorage.setItem(
      "pipeline.mock.wallet.contract.depositManager.minDeposit",
      "1000000",
    );

    const { result } = renderHook(() => useDepositManagerMinDeposit(), {
      wrapper,
    });

    expect(result.current.minDeposit).toBe(1_000_000n);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();

    // All useReadContract calls for minDeposit should have enabled=false
    const calls = mockUseReadContract.mock.calls as unknown as Array<
      [{ functionName?: string; query?: { enabled?: boolean } }]
    >;
    const minDepositCalls = calls.filter(
      (call) => call[0]?.functionName === "minDeposit",
    );
    for (const call of minDepositCalls) {
      expect(call[0]?.query?.enabled).toBe(false);
    }
  });

  it("does not call fetch when named alias is set", () => {
    localStorage.setItem(
      "pipeline.mock.wallet.contract.depositManager.minDeposit",
      "1000000",
    );
    fetchSpy.mockClear();

    renderHook(() => useDepositManagerMinDeposit(), { wrapper });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("useDepositManagerMinDeposit — generic per-address mock", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseReadContract.mockClear();
    resetEnv();
  });

  afterEach(() => {
    localStorage.clear();
    resetEnv();
  });

  it("returns parsed bigint from generic per-address key", () => {
    const dmAddr = "0xAAAA000000000000000000000000000000000010";
    mockEnv.DEPOSIT_MANAGER_ADDRESS = dmAddr as `0x${string}`;

    localStorage.setItem(
      `pipeline.mock.wallet.contract.${dmAddr.toLowerCase()}.minDeposit`,
      "2500000",
    );

    const { result } = renderHook(() => useDepositManagerMinDeposit(), {
      wrapper,
    });

    expect(result.current.minDeposit).toBe(2_500_000n);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });
});

describe("useDepositManagerMinDeposit — named alias priority over generic", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseReadContract.mockClear();
    resetEnv();
  });

  afterEach(() => {
    localStorage.clear();
    resetEnv();
  });

  it("named alias wins when both alias and generic keys are set", () => {
    const dmAddr = "0xBBBB000000000000000000000000000000000011";
    mockEnv.DEPOSIT_MANAGER_ADDRESS = dmAddr as `0x${string}`;

    // Named alias → 1_000_000n
    localStorage.setItem(
      "pipeline.mock.wallet.contract.depositManager.minDeposit",
      "1000000",
    );
    // Generic per-address → 9_999_999n (should be ignored)
    localStorage.setItem(
      `pipeline.mock.wallet.contract.${dmAddr.toLowerCase()}.minDeposit`,
      "9999999",
    );

    const { result } = renderHook(() => useDepositManagerMinDeposit(), {
      wrapper,
    });

    expect(result.current.minDeposit).toBe(1_000_000n);
  });
});

describe("useDepositManagerMinDeposit — zero-address short-circuit", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseReadContract.mockClear();
    resetEnv();
  });

  it("returns undefined and disables all reads when DM address is zero", () => {
    // Default env has zero DM address
    const { result } = renderHook(() => useDepositManagerMinDeposit(), {
      wrapper,
    });

    expect(result.current.minDeposit).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();

    const calls = mockUseReadContract.mock.calls as unknown as Array<
      [{ query?: { enabled?: boolean } }]
    >;
    for (const call of calls) {
      expect(call[0]?.query?.enabled).toBe(false);
    }
  });
});

describe("useDepositManagerMinDeposit — caching options forwarded", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseReadContract.mockClear();
    resetEnv();
  });

  afterEach(() => {
    localStorage.clear();
    resetEnv();
  });

  it("forwards staleTime:Infinity and all refetch:false flags to useReadContract", () => {
    const dmAddr = "0xCCCC000000000000000000000000000000000012";
    mockEnv.DEPOSIT_MANAGER_ADDRESS = dmAddr as `0x${string}`;

    renderHook(() => useDepositManagerMinDeposit(), { wrapper });

    const calls = mockUseReadContract.mock.calls as unknown as Array<
      [
        {
          functionName?: string;
          query?: {
            enabled?: boolean;
            staleTime?: number;
            gcTime?: number;
            refetchOnWindowFocus?: boolean;
            refetchOnReconnect?: boolean;
            refetchOnMount?: boolean;
            refetchInterval?: boolean | number;
          };
        },
      ]
    >;

    const minDepositCalls = calls.filter(
      (call) => call[0]?.functionName === "minDeposit",
    );
    expect(minDepositCalls.length).toBeGreaterThan(0);
    for (const call of minDepositCalls) {
      const q = call[0]?.query;
      if (q) {
        expect(q.staleTime).toBe(Infinity);
        expect(q.gcTime).toBe(Infinity);
        expect(q.refetchOnWindowFocus).toBe(false);
        expect(q.refetchOnReconnect).toBe(false);
        expect(q.refetchOnMount).toBe(false);
        expect(q.refetchInterval).toBe(false);
      }
    }
  });
});

describe("useDepositManagerMinDeposit — real RPC path", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseReadContract.mockClear();
    resetEnv();
  });

  afterEach(() => {
    localStorage.clear();
    mockUseReadContract.mockReset();
    mockUseReadContract.mockImplementation(() => ({
      data: undefined as unknown,
      isLoading: false,
      error: null,
    }));
    resetEnv();
  });

  it("returns wagmi data unchanged on real RPC path", () => {
    const dmAddr = "0xDDDD000000000000000000000000000000000013";
    mockEnv.DEPOSIT_MANAGER_ADDRESS = dmAddr as `0x${string}`;

    // Override mockUseReadContract to return 5_000_000n for minDeposit
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockUseReadContract as any).mockImplementation(
      (args: { functionName?: string }) => {
        if (args?.functionName === "minDeposit") {
          return { data: 5_000_000n, isLoading: false, error: null };
        }
        return { data: undefined as unknown, isLoading: false, error: null };
      },
    );

    const { result } = renderHook(() => useDepositManagerMinDeposit(), {
      wrapper,
    });

    expect(result.current.minDeposit).toBe(5_000_000n);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });
});
