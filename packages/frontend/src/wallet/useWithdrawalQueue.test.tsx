import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { WalletProvider } from "./WalletProvider";
import {
  useWithdrawalQueueAddresses,
  useRequestWithdrawal,
  useClaimWithdrawal,
} from "./useWithdrawalQueue";

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
// We mock the env module so tests can override WITHDRAWAL_QUEUE_ADDRESS.
// `mockEnv` must be declared via vi.hoisted so it's available in the
// vi.mock factory (which is hoisted to the top of the file by vitest).

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const mockEnv = vi.hoisted(() => ({
  EVM_CHAIN_ID: 560048,
  EVM_RPC_URL: "https://ethereum-hoodi-rpc.publicnode.com",
  DEPOSIT_MANAGER_ADDRESS:
    "0x0000000000000000000000000000000000000000" as `0x${string}`,
  WITHDRAWAL_QUEUE_ADDRESS:
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
  mockEnv.WITHDRAWAL_QUEUE_ADDRESS = ZERO_ADDRESS as `0x${string}`;
}

// ── useWithdrawalQueueAddresses — named alias mocks ───────────────────────────

describe("useWithdrawalQueueAddresses — named alias mocks", () => {
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
      "pipeline.mock.wallet.contract.withdrawalQueue.plusd",
      "0xAAAA000000000000000000000000000000000001",
    );
    localStorage.setItem(
      "pipeline.mock.wallet.contract.withdrawalQueue.usdc",
      "0xBBBB000000000000000000000000000000000002",
    );

    const { result } = renderHook(() => useWithdrawalQueueAddresses(), {
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
      "pipeline.mock.wallet.contract.withdrawalQueue.plusd",
      "0xAAAA000000000000000000000000000000000001",
    );
    localStorage.setItem(
      "pipeline.mock.wallet.contract.withdrawalQueue.usdc",
      "0xBBBB000000000000000000000000000000000002",
    );

    renderHook(() => useWithdrawalQueueAddresses(), { wrapper });

    // All useReadContract calls should have enabled=false
    const calls = mockUseReadContract.mock.calls as unknown as Array<
      [{ query?: { enabled?: boolean } }]
    >;
    for (const call of calls) {
      expect(call[0]?.query?.enabled).toBe(false);
    }
  });
});

// ── useWithdrawalQueueAddresses — generic per-address mock ────────────────────

describe("useWithdrawalQueueAddresses — generic per-address mock", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseReadContract.mockClear();
    resetEnv();
  });

  afterEach(() => {
    localStorage.clear();
    resetEnv();
  });

  it("returns values from generic per-address keys (fromToken/intoToken) when env is non-zero", () => {
    const wqAddr = "0xDDDD000000000000000000000000000000000003";
    mockEnv.WITHDRAWAL_QUEUE_ADDRESS = wqAddr as `0x${string}`;

    localStorage.setItem(
      `pipeline.mock.wallet.contract.${wqAddr.toLowerCase()}.fromToken`,
      "0xCCCC000000000000000000000000000000000004",
    );
    localStorage.setItem(
      `pipeline.mock.wallet.contract.${wqAddr.toLowerCase()}.intoToken`,
      "0xDDDD000000000000000000000000000000000005",
    );

    const { result } = renderHook(() => useWithdrawalQueueAddresses(), {
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
    const wqAddrUpper = "0xAAAABBBBCCCCDDDDEEEEFFFF000000000000ABCD";
    const wqAddrLower = wqAddrUpper.toLowerCase();
    mockEnv.WITHDRAWAL_QUEUE_ADDRESS = wqAddrUpper as `0x${string}`;

    localStorage.setItem(
      `pipeline.mock.wallet.contract.${wqAddrLower}.fromToken`,
      "0xAAAA000000000000000000000000000000000001",
    );
    localStorage.setItem(
      `pipeline.mock.wallet.contract.${wqAddrLower}.intoToken`,
      "0xBBBB000000000000000000000000000000000002",
    );

    const { result } = renderHook(() => useWithdrawalQueueAddresses(), {
      wrapper,
    });

    expect(result.current.plusd).toBe(
      "0xAAAA000000000000000000000000000000000001",
    );
  });
});

// ── useWithdrawalQueueAddresses — named alias priority ─────────────────────────

describe("useWithdrawalQueueAddresses — named alias priority", () => {
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
    const wqAddr = "0xBBBB000000000000000000000000000000000011";
    mockEnv.WITHDRAWAL_QUEUE_ADDRESS = wqAddr as `0x${string}`;

    // Named alias → priority address
    localStorage.setItem(
      "pipeline.mock.wallet.contract.withdrawalQueue.plusd",
      "0xAAAA000000000000000000000000000000ALIAS1",
    );
    // Generic per-address → should be ignored
    localStorage.setItem(
      `pipeline.mock.wallet.contract.${wqAddr.toLowerCase()}.fromToken`,
      "0xGGGG000000000000000000000000000000GENERIC",
    );

    const { result } = renderHook(() => useWithdrawalQueueAddresses(), {
      wrapper,
    });

    expect(result.current.plusd).toBe(
      "0xAAAA000000000000000000000000000000ALIAS1",
    );
  });
});

// ── useWithdrawalQueueAddresses — zero-address short-circuit ──────────────────

describe("useWithdrawalQueueAddresses — zero-address short-circuit", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseReadContract.mockClear();
    resetEnv();
  });

  it("returns undefined data without RPC when WQ address is zero (default env)", () => {
    const { result } = renderHook(() => useWithdrawalQueueAddresses(), {
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

// ── useWithdrawalQueueAddresses — caching options forwarded ───────────────────

describe("useWithdrawalQueueAddresses — caching options forwarded", () => {
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
    const wqAddr = "0xEEEE000000000000000000000000000000000006";
    mockEnv.WITHDRAWAL_QUEUE_ADDRESS = wqAddr as `0x${string}`;

    renderHook(() => useWithdrawalQueueAddresses(), { wrapper });

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

    // Each call (fromToken + intoToken) should have the caching flags
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

// ── useRequestWithdrawal — args pass-through ──────────────────────────────────

describe("useRequestWithdrawal — args pass-through (no mock, non-zero address)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    mockUseWriteContract.mockClear();
    mockUseReadContract.mockClear();
    mockEstimateContractGas.mockClear();
    mockEstimateContractGas.mockResolvedValue(1_000_000n);
    resetEnv();
    // Set a connected wallet so estimation proceeds.
    localStorage.setItem(
      "pipeline.mock.wallet.address",
      "0xWALLET0000000000000000000000000000000001",
    );
  });

  afterEach(() => {
    localStorage.clear();
    resetEnv();
  });

  it("calls wagmi writeContract with buffered gas for non-zero WQ address", async () => {
    const wqAddr = "0xFFFF000000000000000000000000000000000007";
    mockEnv.WITHDRAWAL_QUEUE_ADDRESS = wqAddr as `0x${string}`;

    const { result } = renderHook(() => useRequestWithdrawal(), { wrapper });

    act(() => {
      result.current.write(123n);
    });

    await waitFor(() => {
      expect(mockWriteContract).toHaveBeenCalled();
    });

    expect(mockWriteContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "requestWithdrawal",
        address: wqAddr,
        args: [123n],
        gas: 1_200_000n, // 1_000_000n * 12 / 10
      }),
    );
  });
});

// ── useRequestWithdrawal — mock key bypasses RPC ──────────────────────────────

describe("useRequestWithdrawal — mock key bypasses RPC", () => {
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

  it("returns mocked data (hash + requestId + queued) and does NOT call writeContract", async () => {
    const mockData = { hash: "0xabc", requestId: "42", queued: "1000000" };
    localStorage.setItem(
      "pipeline.mock.wallet.contract.withdrawalQueue.requestWithdrawal",
      JSON.stringify(mockData),
    );

    const { result } = renderHook(() => useRequestWithdrawal(), { wrapper });

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
    const mockData = { hash: "0xabc", requestId: "42", queued: "1000000" };
    localStorage.setItem(
      "pipeline.mock.wallet.contract.withdrawalQueue.requestWithdrawal",
      JSON.stringify(mockData),
    );

    const { result } = renderHook(() => useRequestWithdrawal(), { wrapper });

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

// ── useRequestWithdrawal — zero-address disables ──────────────────────────────

describe("useRequestWithdrawal — zero-address disables", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    resetEnv();
  });

  it("sets error and does NOT call writeContract when WQ address is zero", () => {
    // Default ENV has zero WQ address
    const { result } = renderHook(() => useRequestWithdrawal(), { wrapper });

    act(() => {
      result.current.write(123n);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toMatch(
      /WithdrawalQueue not configured/,
    );
    expect(mockWriteContract).not.toHaveBeenCalled();
  });
});

// ── useRequestWithdrawal — reset semantics ────────────────────────────────────

describe("useRequestWithdrawal — reset semantics", () => {
  beforeEach(() => {
    localStorage.clear();
    resetEnv();
  });

  afterEach(() => {
    localStorage.clear();
    resetEnv();
  });

  it("reset() clears data and isSuccess in mock mode", async () => {
    const mockData = { hash: "0xabc", requestId: "42", queued: "1000000" };
    localStorage.setItem(
      "pipeline.mock.wallet.contract.withdrawalQueue.requestWithdrawal",
      JSON.stringify(mockData),
    );

    const { result } = renderHook(() => useRequestWithdrawal(), { wrapper });

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

// ── useClaimWithdrawal — args pass-through ────────────────────────────────────

describe("useClaimWithdrawal — args pass-through (no mock, non-zero address)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    mockUseWriteContract.mockClear();
    mockEstimateContractGas.mockClear();
    mockEstimateContractGas.mockResolvedValue(1_000_000n);
    resetEnv();
    // Set a connected wallet so estimation proceeds.
    localStorage.setItem(
      "pipeline.mock.wallet.address",
      "0xWALLET0000000000000000000000000000000002",
    );
  });

  afterEach(() => {
    localStorage.clear();
    resetEnv();
  });

  it("calls wagmi writeContract with buffered gas for non-zero WQ address", async () => {
    const wqAddr = "0xFFFF000000000000000000000000000000000008";
    mockEnv.WITHDRAWAL_QUEUE_ADDRESS = wqAddr as `0x${string}`;

    const { result } = renderHook(() => useClaimWithdrawal(), { wrapper });

    act(() => {
      result.current.write(99n, "0xdeadbeef" as `0x${string}`);
    });

    await waitFor(() => {
      expect(mockWriteContract).toHaveBeenCalled();
    });

    expect(mockWriteContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "claimWithdrawal",
        address: wqAddr,
        args: [99n, "0xdeadbeef"],
        gas: 1_200_000n, // 1_000_000n * 12 / 10
      }),
    );
  });
});

// ── useClaimWithdrawal — mock key bypasses RPC ────────────────────────────────

describe("useClaimWithdrawal — mock key bypasses RPC", () => {
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

  it("returns mocked data (hash + amount) and does NOT call writeContract or fetch", async () => {
    const mockData = { hash: "0xdef", amount: "1000000" };
    localStorage.setItem(
      "pipeline.mock.wallet.contract.withdrawalQueue.claimWithdrawal",
      JSON.stringify(mockData),
    );

    const { result } = renderHook(() => useClaimWithdrawal(), { wrapper });

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

// ── useClaimWithdrawal — zero-address disables ────────────────────────────────

describe("useClaimWithdrawal — zero-address disables", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    resetEnv();
  });

  it("sets error and does NOT call writeContract when WQ address is zero", () => {
    const { result } = renderHook(() => useClaimWithdrawal(), { wrapper });

    act(() => {
      result.current.write(99n, "0xdeadbeef" as `0x${string}`);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toMatch(
      /WithdrawalQueue not configured/,
    );
    expect(mockWriteContract).not.toHaveBeenCalled();
  });
});

// ── useClaimWithdrawal — reset semantics ──────────────────────────────────────

describe("useClaimWithdrawal — reset semantics", () => {
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
      "pipeline.mock.wallet.contract.withdrawalQueue.claimWithdrawal",
      JSON.stringify(mockData),
    );

    const { result } = renderHook(() => useClaimWithdrawal(), { wrapper });

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

// ── useClaimWithdrawal — gas estimation tests ─────────────────────────────────

describe("useClaimWithdrawal — gas estimation: cap clamp", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    mockEstimateContractGas.mockClear();
    resetEnv();
    localStorage.setItem(
      "pipeline.mock.wallet.address",
      "0xWALLET0000000000000000000000000000000003",
    );
  });

  afterEach(() => {
    localStorage.clear();
    resetEnv();
  });

  it("clamps gas to EVM_TX_GAS_CAP when buffered estimate exceeds the cap", async () => {
    const wqAddr = "0xFFFF000000000000000000000000000000000009";
    mockEnv.WITHDRAWAL_QUEUE_ADDRESS = wqAddr as `0x${string}`;
    mockEstimateContractGas.mockResolvedValue(20_000_000n);

    const { result } = renderHook(() => useClaimWithdrawal(), { wrapper });

    act(() => {
      result.current.write(1n, "0xsig" as `0x${string}`);
    });

    await waitFor(() => {
      expect(mockWriteContract).toHaveBeenCalled();
    });

    const callArgs = mockWriteContract.mock.calls[0]?.[0] as {
      gas?: bigint;
    };
    expect(callArgs?.gas).toBe(16_777_215n);
  });
});

describe("useClaimWithdrawal — gas estimation: estimation rejects", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    mockEstimateContractGas.mockClear();
    resetEnv();
    localStorage.setItem(
      "pipeline.mock.wallet.address",
      "0xWALLET0000000000000000000000000000000004",
    );
  });

  afterEach(() => {
    localStorage.clear();
    resetEnv();
  });

  it("surfaces error on hook and does NOT call writeContract when estimation throws", async () => {
    const wqAddr = "0xFFFF000000000000000000000000000000000010";
    mockEnv.WITHDRAWAL_QUEUE_ADDRESS = wqAddr as `0x${string}`;
    mockEstimateContractGas.mockRejectedValue(
      new Error("execution reverted: already claimed"),
    );

    const { result } = renderHook(() => useClaimWithdrawal(), { wrapper });

    act(() => {
      result.current.write(1n, "0xsig" as `0x${string}`);
    });

    await waitFor(() => {
      expect(result.current.error).toBeTruthy();
    });

    expect(result.current.error?.message).toMatch(/already claimed/);
    expect(mockWriteContract).not.toHaveBeenCalled();
  });
});

describe("useClaimWithdrawal — gas estimation: mock key bypasses estimation", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    mockEstimateContractGas.mockClear();
    resetEnv();
  });

  afterEach(() => {
    localStorage.clear();
    resetEnv();
  });

  it("does NOT call estimateContractGas when mock key is present", async () => {
    const mockData = { hash: "0xmocked", amount: "1000000" };
    localStorage.setItem(
      "pipeline.mock.wallet.contract.withdrawalQueue.claimWithdrawal",
      JSON.stringify(mockData),
    );

    const { result } = renderHook(() => useClaimWithdrawal(), { wrapper });

    act(() => {
      result.current.write(1n, "0xsig" as `0x${string}`);
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockEstimateContractGas).not.toHaveBeenCalled();
    expect(mockWriteContract).not.toHaveBeenCalled();
  });
});
