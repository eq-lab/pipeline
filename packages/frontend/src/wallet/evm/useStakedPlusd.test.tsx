import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { EvmWalletProvider } from "./EvmWalletProvider";
import {
  useStakedPlusdAsset,
  useStakedPlusdConvertToShares,
  useStakedPlusdConvertToAssets,
  useStake,
  useUnstake,
} from "./useStakedPlusd";

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

// Mock publicClient for gas estimation and simulate pre-flight.
const mockEstimateContractGas = vi.fn(async () => 1_000_000n);
const mockSimulateContract = vi.fn(async () => undefined);
const mockPublicClient = {
  estimateContractGas: mockEstimateContractGas,
  simulateContract: mockSimulateContract,
};
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
// We mock the env module so tests can override STAKED_PLUSD_ADDRESS.
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
  STAKED_PLUSD_ADDRESS:
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

// ── Mock useWallet to control address ────────────────────────────────────────

const mockUseWallet = vi.fn(() => ({
  address: undefined as `0x${string}` | undefined,
  isConnected: false,
  chainId: 560048,
  connect: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock("./useEvmWallet", () => ({
  useEvmWallet: () => mockUseWallet(),
  useContractRead: vi.fn(),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return <EvmWalletProvider>{children}</EvmWalletProvider>;
}

// Helper: reset mockEnv to defaults
function resetEnv() {
  mockEnv.STAKED_PLUSD_ADDRESS = ZERO_ADDRESS as `0x${string}`;
}

// Helper: set a non-zero SP address
const SP_ADDR = "0xAAAA000000000000000000000000000000000001" as `0x${string}`;

// ── useStakedPlusdAsset — named alias mock ────────────────────────────────────

describe("useStakedPlusdAsset — named alias mock", () => {
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

  it("returns plusd from named alias key", () => {
    localStorage.setItem(
      "pipeline.mock.wallet.contract.stakedPlusd.asset",
      "0xBBBB000000000000000000000000000000000002",
    );

    const { result } = renderHook(() => useStakedPlusdAsset(), { wrapper });

    expect(result.current.plusd).toBe(
      "0xBBBB000000000000000000000000000000000002",
    );
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("disables real read (query.enabled false) when named alias is set", () => {
    localStorage.setItem(
      "pipeline.mock.wallet.contract.stakedPlusd.asset",
      "0xBBBB000000000000000000000000000000000002",
    );

    renderHook(() => useStakedPlusdAsset(), { wrapper });

    const calls = mockUseReadContract.mock.calls as unknown as Array<
      [{ query?: { enabled?: boolean } }]
    >;
    for (const call of calls) {
      expect(call[0]?.query?.enabled).toBe(false);
    }
  });

  it("does not call fetch in named alias mock mode", () => {
    localStorage.setItem(
      "pipeline.mock.wallet.contract.stakedPlusd.asset",
      "0xBBBB000000000000000000000000000000000002",
    );

    renderHook(() => useStakedPlusdAsset(), { wrapper });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── useStakedPlusdAsset — generic per-address mock ────────────────────────────

describe("useStakedPlusdAsset — generic per-address mock", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseReadContract.mockClear();
    resetEnv();
  });

  afterEach(() => {
    localStorage.clear();
    resetEnv();
  });

  it("returns value from generic per-address key when env is non-zero", () => {
    mockEnv.STAKED_PLUSD_ADDRESS = SP_ADDR;

    localStorage.setItem(
      `pipeline.mock.wallet.contract.${SP_ADDR.toLowerCase()}.asset`,
      "0xCCCC000000000000000000000000000000000003",
    );

    const { result } = renderHook(() => useStakedPlusdAsset(), { wrapper });

    expect(result.current.plusd).toBe(
      "0xCCCC000000000000000000000000000000000003",
    );
    expect(result.current.isLoading).toBe(false);
  });

  it("generic key works when env address has uppercase hex letters", () => {
    const spAddrUpper =
      "0xAAAABBBBCCCCDDDDEEEEFFFF000000000000ABCD" as `0x${string}`;
    const spAddrLower = spAddrUpper.toLowerCase();
    mockEnv.STAKED_PLUSD_ADDRESS = spAddrUpper;

    localStorage.setItem(
      `pipeline.mock.wallet.contract.${spAddrLower}.asset`,
      "0xDDDD000000000000000000000000000000000004",
    );

    const { result } = renderHook(() => useStakedPlusdAsset(), { wrapper });

    expect(result.current.plusd).toBe(
      "0xDDDD000000000000000000000000000000000004",
    );
  });
});

// ── useStakedPlusdAsset — named alias priority ────────────────────────────────

describe("useStakedPlusdAsset — named alias priority", () => {
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
    mockEnv.STAKED_PLUSD_ADDRESS = SP_ADDR;

    // Named alias → priority address
    localStorage.setItem(
      "pipeline.mock.wallet.contract.stakedPlusd.asset",
      "0xAAAA000000000000000000000000000000ALIAS1",
    );
    // Generic per-address → should be ignored
    localStorage.setItem(
      `pipeline.mock.wallet.contract.${SP_ADDR.toLowerCase()}.asset`,
      "0xBBBB000000000000000000000000000000GENRC2",
    );

    const { result } = renderHook(() => useStakedPlusdAsset(), { wrapper });

    expect(result.current.plusd).toBe(
      "0xAAAA000000000000000000000000000000ALIAS1",
    );
  });
});

// ── useStakedPlusdAsset — zero-address short-circuit ─────────────────────────

describe("useStakedPlusdAsset — zero-address short-circuit", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseReadContract.mockClear();
    resetEnv();
  });

  it("returns undefined data without RPC when SP address is zero (default env)", () => {
    const { result } = renderHook(() => useStakedPlusdAsset(), { wrapper });

    expect(result.current.plusd).toBeUndefined();
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

// ── useStakedPlusdAsset — caching options forwarded ──────────────────────────

describe("useStakedPlusdAsset — caching options forwarded", () => {
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
    mockEnv.STAKED_PLUSD_ADDRESS = SP_ADDR;

    renderHook(() => useStakedPlusdAsset(), { wrapper });

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

// ── useStakedPlusdConvertToShares — undefined input disables ──────────────────

describe("useStakedPlusdConvertToShares — undefined input disables", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseReadContract.mockClear();
    resetEnv();
  });

  it("returns data:undefined with enabled:false when input is undefined", () => {
    mockEnv.STAKED_PLUSD_ADDRESS = SP_ADDR;

    const { result } = renderHook(
      () => useStakedPlusdConvertToShares(undefined),
      { wrapper },
    );

    expect(result.current.data).toBeUndefined();
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

// ── useStakedPlusdConvertToShares — zero input disables ──────────────────────

describe("useStakedPlusdConvertToShares — zero input disables", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseReadContract.mockClear();
    resetEnv();
  });

  it("returns data:undefined with enabled:false when input is 0n", () => {
    mockEnv.STAKED_PLUSD_ADDRESS = SP_ADDR;

    const { result } = renderHook(() => useStakedPlusdConvertToShares(0n), {
      wrapper,
    });

    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);

    const calls = mockUseReadContract.mock.calls as unknown as Array<
      [{ query?: { enabled?: boolean } }]
    >;
    for (const call of calls) {
      expect(call[0]?.query?.enabled).toBe(false);
    }
  });
});

// ── useStakedPlusdConvertToShares — real path forwards args ──────────────────

describe("useStakedPlusdConvertToShares — real path forwards args", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseReadContract.mockClear();
    resetEnv();
  });

  afterEach(() => {
    localStorage.clear();
    resetEnv();
  });

  it("calls useReadContract with correct args and caching for non-zero input", () => {
    mockEnv.STAKED_PLUSD_ADDRESS = SP_ADDR;
    const input = 1_000_000_000_000_000_000n;

    renderHook(() => useStakedPlusdConvertToShares(input), { wrapper });

    const calls = mockUseReadContract.mock.calls as unknown as Array<
      [
        {
          functionName?: string;
          address?: string;
          args?: unknown[];
          query?: {
            enabled?: boolean;
            staleTime?: number;
            refetchInterval?: number;
          };
        },
      ]
    >;

    const convertCall = calls.find(
      (c) => c[0]?.functionName === "convertToShares",
    );
    expect(convertCall).toBeDefined();
    expect(convertCall![0].address).toBe(SP_ADDR);
    expect(convertCall![0].args).toEqual([input]);
    expect(convertCall![0].query?.staleTime).toBe(30_000);
    expect(convertCall![0].query?.refetchInterval).toBe(30_000);
    expect(convertCall![0].query?.enabled).toBe(true);
  });
});

// ── useStakedPlusdConvertToShares — mock-path rate maths ─────────────────────

describe("useStakedPlusdConvertToShares — mock-path rate maths", () => {
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

  it("computes (input * rate) / 1e18 for 1 PLUSD input with named alias", () => {
    mockEnv.STAKED_PLUSD_ADDRESS = SP_ADDR;
    // Rate: 0.9596 sPLUSD per 1 PLUSD (at 1e18 scale)
    localStorage.setItem(
      "pipeline.mock.wallet.contract.stakedPlusd.convertToShares",
      "959600000000000000",
    );

    const { result } = renderHook(
      () => useStakedPlusdConvertToShares(1_000_000_000_000_000_000n),
      { wrapper },
    );

    expect(result.current.data).toBe(959_600_000_000_000_000n);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("computes (input * rate) / 1e18 for 0.5 PLUSD input with named alias", () => {
    mockEnv.STAKED_PLUSD_ADDRESS = SP_ADDR;
    localStorage.setItem(
      "pipeline.mock.wallet.contract.stakedPlusd.convertToShares",
      "959600000000000000",
    );

    const { result } = renderHook(
      () => useStakedPlusdConvertToShares(500_000_000_000_000_000n),
      { wrapper },
    );

    expect(result.current.data).toBe(479_800_000_000_000_000n);
  });

  it("disables useReadContract when mock rate is set", () => {
    mockEnv.STAKED_PLUSD_ADDRESS = SP_ADDR;
    localStorage.setItem(
      "pipeline.mock.wallet.contract.stakedPlusd.convertToShares",
      "959600000000000000",
    );

    renderHook(
      () => useStakedPlusdConvertToShares(1_000_000_000_000_000_000n),
      { wrapper },
    );

    const calls = mockUseReadContract.mock.calls as unknown as Array<
      [{ query?: { enabled?: boolean } }]
    >;
    for (const call of calls) {
      expect(call[0]?.query?.enabled).toBe(false);
    }
  });
});

// ── useStakedPlusdConvertToShares — generic per-address rate mock ─────────────

describe("useStakedPlusdConvertToShares — generic per-address rate mock", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseReadContract.mockClear();
    resetEnv();
  });

  afterEach(() => {
    localStorage.clear();
    resetEnv();
  });

  it("computes rate maths using generic per-address key", () => {
    mockEnv.STAKED_PLUSD_ADDRESS = SP_ADDR;
    localStorage.setItem(
      `pipeline.mock.wallet.contract.${SP_ADDR.toLowerCase()}.convertToShares`,
      "959600000000000000",
    );

    const { result } = renderHook(
      () => useStakedPlusdConvertToShares(1_000_000_000_000_000_000n),
      { wrapper },
    );

    expect(result.current.data).toBe(959_600_000_000_000_000n);
  });
});

// ── useStakedPlusdConvertToShares — zero-address short-circuit ────────────────

describe("useStakedPlusdConvertToShares — zero-address short-circuit", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseReadContract.mockClear();
    resetEnv();
  });

  it("returns data:undefined when SP address is zero", () => {
    const { result } = renderHook(
      () => useStakedPlusdConvertToShares(1_000_000_000_000_000_000n),
      { wrapper },
    );

    expect(result.current.data).toBeUndefined();

    const calls = mockUseReadContract.mock.calls as unknown as Array<
      [{ query?: { enabled?: boolean } }]
    >;
    for (const call of calls) {
      expect(call[0]?.query?.enabled).toBe(false);
    }
  });
});

// ── useStakedPlusdConvertToAssets — undefined input disables ──────────────────

describe("useStakedPlusdConvertToAssets — undefined input disables", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseReadContract.mockClear();
    resetEnv();
  });

  it("returns data:undefined with enabled:false when input is undefined", () => {
    mockEnv.STAKED_PLUSD_ADDRESS = SP_ADDR;

    const { result } = renderHook(
      () => useStakedPlusdConvertToAssets(undefined),
      { wrapper },
    );

    expect(result.current.data).toBeUndefined();
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

// ── useStakedPlusdConvertToAssets — zero input disables ──────────────────────

describe("useStakedPlusdConvertToAssets — zero input disables", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseReadContract.mockClear();
    resetEnv();
  });

  it("returns data:undefined with enabled:false when input is 0n", () => {
    mockEnv.STAKED_PLUSD_ADDRESS = SP_ADDR;

    const { result } = renderHook(() => useStakedPlusdConvertToAssets(0n), {
      wrapper,
    });

    expect(result.current.data).toBeUndefined();
  });
});

// ── useStakedPlusdConvertToAssets — real path forwards args ──────────────────

describe("useStakedPlusdConvertToAssets — real path forwards args", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseReadContract.mockClear();
    resetEnv();
  });

  afterEach(() => {
    localStorage.clear();
    resetEnv();
  });

  it("calls useReadContract with correct args and caching for non-zero input", () => {
    mockEnv.STAKED_PLUSD_ADDRESS = SP_ADDR;
    const input = 1_000_000_000_000_000_000n;

    renderHook(() => useStakedPlusdConvertToAssets(input), { wrapper });

    const calls = mockUseReadContract.mock.calls as unknown as Array<
      [
        {
          functionName?: string;
          address?: string;
          args?: unknown[];
          query?: {
            enabled?: boolean;
            staleTime?: number;
            refetchInterval?: number;
          };
        },
      ]
    >;

    const convertCall = calls.find(
      (c) => c[0]?.functionName === "convertToAssets",
    );
    expect(convertCall).toBeDefined();
    expect(convertCall![0].address).toBe(SP_ADDR);
    expect(convertCall![0].args).toEqual([input]);
    expect(convertCall![0].query?.staleTime).toBe(30_000);
    expect(convertCall![0].query?.refetchInterval).toBe(30_000);
    expect(convertCall![0].query?.enabled).toBe(true);
  });
});

// ── useStakedPlusdConvertToAssets — mock-path rate maths ─────────────────────

describe("useStakedPlusdConvertToAssets — mock-path rate maths", () => {
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

  it("computes (input * rate) / 1e18 for 1 sPLUSD input with named alias", () => {
    mockEnv.STAKED_PLUSD_ADDRESS = SP_ADDR;
    // Inverse rate: 1.0421 PLUSD per 1 sPLUSD (at 1e18 scale)
    localStorage.setItem(
      "pipeline.mock.wallet.contract.stakedPlusd.convertToAssets",
      "1042100000000000000",
    );

    const { result } = renderHook(
      () => useStakedPlusdConvertToAssets(1_000_000_000_000_000_000n),
      { wrapper },
    );

    expect(result.current.data).toBe(1_042_100_000_000_000_000n);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("computes (input * rate) / 1e18 for 0.5 sPLUSD input with named alias", () => {
    mockEnv.STAKED_PLUSD_ADDRESS = SP_ADDR;
    localStorage.setItem(
      "pipeline.mock.wallet.contract.stakedPlusd.convertToAssets",
      "1042100000000000000",
    );

    const { result } = renderHook(
      () => useStakedPlusdConvertToAssets(500_000_000_000_000_000n),
      { wrapper },
    );

    expect(result.current.data).toBe(521_050_000_000_000_000n);
  });
});

// ── useStakedPlusdConvertToAssets — generic per-address rate mock ─────────────

describe("useStakedPlusdConvertToAssets — generic per-address rate mock", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseReadContract.mockClear();
    resetEnv();
  });

  afterEach(() => {
    localStorage.clear();
    resetEnv();
  });

  it("computes rate maths using generic per-address key", () => {
    mockEnv.STAKED_PLUSD_ADDRESS = SP_ADDR;
    localStorage.setItem(
      `pipeline.mock.wallet.contract.${SP_ADDR.toLowerCase()}.convertToAssets`,
      "1042100000000000000",
    );

    const { result } = renderHook(
      () => useStakedPlusdConvertToAssets(1_000_000_000_000_000_000n),
      { wrapper },
    );

    expect(result.current.data).toBe(1_042_100_000_000_000_000n);
  });
});

// ── useStakedPlusdConvertToAssets — zero-address short-circuit ────────────────

describe("useStakedPlusdConvertToAssets — zero-address short-circuit", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseReadContract.mockClear();
    resetEnv();
  });

  it("returns data:undefined when SP address is zero", () => {
    const { result } = renderHook(
      () => useStakedPlusdConvertToAssets(1_000_000_000_000_000_000n),
      { wrapper },
    );

    expect(result.current.data).toBeUndefined();

    const calls = mockUseReadContract.mock.calls as unknown as Array<
      [{ query?: { enabled?: boolean } }]
    >;
    for (const call of calls) {
      expect(call[0]?.query?.enabled).toBe(false);
    }
  });
});

// ── useStake — args pass-through ──────────────────────────────────────────────

describe("useStake — args pass-through (no mock, non-zero address)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    mockUseWriteContract.mockClear();
    mockUseReadContract.mockClear();
    mockEstimateContractGas.mockClear();
    mockEstimateContractGas.mockResolvedValue(1_000_000n);
    mockSimulateContract.mockClear();
    mockSimulateContract.mockResolvedValue(undefined);
    resetEnv();
  });

  afterEach(() => {
    localStorage.clear();
    resetEnv();
  });

  it("calls wagmi writeContract with buffered gas for non-zero SP address and connected wallet", async () => {
    const walletAddr =
      "0xWALL000000000000000000000000000000000099" as `0x${string}`;
    mockEnv.STAKED_PLUSD_ADDRESS = SP_ADDR;
    mockUseWallet.mockReturnValue({
      address: walletAddr,
      isConnected: true,
      chainId: 560048,
      connect: vi.fn(),
      disconnect: vi.fn(),
    });

    const { result } = renderHook(() => useStake(), { wrapper });

    act(() => {
      result.current.write(1_000_000_000_000_000_000n);
    });

    await waitFor(() => {
      expect(mockWriteContract).toHaveBeenCalled();
    });

    expect(mockWriteContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "deposit",
        address: SP_ADDR,
        args: [1_000_000_000_000_000_000n, walletAddr],
        gas: 1_200_000n, // 1_000_000n * 12 / 10
      }),
    );
  });
});

// ── useStake — mock key bypasses RPC ─────────────────────────────────────────

describe("useStake — mock key bypasses RPC", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    fetchSpy.mockClear();
    resetEnv();
    mockUseWallet.mockReturnValue({
      address: undefined,
      isConnected: false,
      chainId: 560048,
      connect: vi.fn(),
      disconnect: vi.fn(),
    });
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    resetEnv();
  });

  it("returns mocked data (hash + shares) and does NOT call writeContract or fetch", async () => {
    const mockData = { hash: "0xabc", shares: "959600000000000000" };
    localStorage.setItem(
      "pipeline.mock.wallet.contract.stakedPlusd.stake",
      JSON.stringify(mockData),
    );

    const { result } = renderHook(() => useStake(), { wrapper });

    act(() => {
      result.current.write(1_000_000_000_000_000_000n);
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(mockData);
    expect(mockWriteContract).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("isPending flips true initially then settles to isSuccess", async () => {
    const mockData = { hash: "0xabc", shares: "959600000000000000" };
    localStorage.setItem(
      "pipeline.mock.wallet.contract.stakedPlusd.stake",
      JSON.stringify(mockData),
    );

    const { result } = renderHook(() => useStake(), { wrapper });

    act(() => {
      result.current.write(1_000_000_000_000_000_000n);
    });

    expect(result.current.isPending).toBe(true);

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
      expect(result.current.isPending).toBe(false);
    });
  });
});

// ── useStake — wallet-not-connected error ─────────────────────────────────────

describe("useStake — wallet-not-connected error", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    resetEnv();
    mockUseWallet.mockReturnValue({
      address: undefined,
      isConnected: false,
      chainId: 560048,
      connect: vi.fn(),
      disconnect: vi.fn(),
    });
  });

  afterEach(() => {
    localStorage.clear();
    resetEnv();
  });

  it("sets Error('Wallet not connected') and does NOT call writeContract when no wallet connected", () => {
    mockEnv.STAKED_PLUSD_ADDRESS = SP_ADDR;

    const { result } = renderHook(() => useStake(), { wrapper });

    act(() => {
      result.current.write(1_000_000_000_000_000_000n);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toMatch(/Wallet not connected/);
    expect(mockWriteContract).not.toHaveBeenCalled();
  });
});

// ── useStake — zero-address disables ─────────────────────────────────────────

describe("useStake — zero-address disables", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    resetEnv();
    mockUseWallet.mockReturnValue({
      address: "0xWALL000000000000000000000000000000000099" as `0x${string}`,
      isConnected: true,
      chainId: 560048,
      connect: vi.fn(),
      disconnect: vi.fn(),
    });
  });

  afterEach(() => {
    localStorage.clear();
    resetEnv();
  });

  it("sets Error('StakedPLUSD not configured') and does NOT call writeContract when SP address is zero", () => {
    // Default ENV has zero SP address
    const { result } = renderHook(() => useStake(), { wrapper });

    act(() => {
      result.current.write(1_000_000_000_000_000_000n);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toMatch(/StakedPLUSD not configured/);
    expect(mockWriteContract).not.toHaveBeenCalled();
  });
});

// ── useStake — reset semantics ────────────────────────────────────────────────

describe("useStake — reset semantics", () => {
  beforeEach(() => {
    localStorage.clear();
    resetEnv();
    mockUseWallet.mockReturnValue({
      address: undefined,
      isConnected: false,
      chainId: 560048,
      connect: vi.fn(),
      disconnect: vi.fn(),
    });
  });

  afterEach(() => {
    localStorage.clear();
    resetEnv();
  });

  it("reset() clears data and isSuccess in mock mode", async () => {
    const mockData = { hash: "0xabc", shares: "959600000000000000" };
    localStorage.setItem(
      "pipeline.mock.wallet.contract.stakedPlusd.stake",
      JSON.stringify(mockData),
    );

    const { result } = renderHook(() => useStake(), { wrapper });

    act(() => {
      result.current.write(1_000_000_000_000_000_000n);
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

// ── useUnstake — args pass-through ────────────────────────────────────────────

describe("useUnstake — args pass-through (no mock, non-zero address)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    mockUseWriteContract.mockClear();
    mockUseReadContract.mockClear();
    mockEstimateContractGas.mockClear();
    mockEstimateContractGas.mockResolvedValue(1_000_000n);
    mockSimulateContract.mockClear();
    mockSimulateContract.mockResolvedValue(undefined);
    resetEnv();
  });

  afterEach(() => {
    localStorage.clear();
    resetEnv();
  });

  it("calls wagmi writeContract with buffered gas (shares, receiver, owner) for non-zero SP address", async () => {
    const walletAddr =
      "0xWALL000000000000000000000000000000000099" as `0x${string}`;
    mockEnv.STAKED_PLUSD_ADDRESS = SP_ADDR;
    mockUseWallet.mockReturnValue({
      address: walletAddr,
      isConnected: true,
      chainId: 560048,
      connect: vi.fn(),
      disconnect: vi.fn(),
    });

    const { result } = renderHook(() => useUnstake(), { wrapper });

    act(() => {
      result.current.write(500_000_000_000_000_000n);
    });

    await waitFor(() => {
      expect(mockWriteContract).toHaveBeenCalled();
    });

    expect(mockWriteContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "redeem",
        address: SP_ADDR,
        args: [500_000_000_000_000_000n, walletAddr, walletAddr],
        gas: 1_200_000n, // 1_000_000n * 12 / 10
      }),
    );
  });
});

// ── useUnstake — mock key bypasses RPC ───────────────────────────────────────

describe("useUnstake — mock key bypasses RPC", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    fetchSpy.mockClear();
    resetEnv();
    mockUseWallet.mockReturnValue({
      address: undefined,
      isConnected: false,
      chainId: 560048,
      connect: vi.fn(),
      disconnect: vi.fn(),
    });
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    resetEnv();
  });

  it("returns mocked data (hash + assets) and does NOT call writeContract or fetch", async () => {
    const mockData = { hash: "0xdef", assets: "1042100000000000000" };
    localStorage.setItem(
      "pipeline.mock.wallet.contract.stakedPlusd.unstake",
      JSON.stringify(mockData),
    );

    const { result } = renderHook(() => useUnstake(), { wrapper });

    act(() => {
      result.current.write(1_000_000_000_000_000_000n);
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(mockData);
    expect(mockWriteContract).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── useUnstake — wallet-not-connected error ───────────────────────────────────

describe("useUnstake — wallet-not-connected error", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    resetEnv();
    mockUseWallet.mockReturnValue({
      address: undefined,
      isConnected: false,
      chainId: 560048,
      connect: vi.fn(),
      disconnect: vi.fn(),
    });
  });

  afterEach(() => {
    localStorage.clear();
    resetEnv();
  });

  it("sets Error('Wallet not connected') and does NOT call writeContract when no wallet connected", () => {
    mockEnv.STAKED_PLUSD_ADDRESS = SP_ADDR;

    const { result } = renderHook(() => useUnstake(), { wrapper });

    act(() => {
      result.current.write(1_000_000_000_000_000_000n);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toMatch(/Wallet not connected/);
    expect(mockWriteContract).not.toHaveBeenCalled();
  });
});

// ── useUnstake — zero-address disables ───────────────────────────────────────

describe("useUnstake — zero-address disables", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    resetEnv();
    mockUseWallet.mockReturnValue({
      address: "0xWALL000000000000000000000000000000000099" as `0x${string}`,
      isConnected: true,
      chainId: 560048,
      connect: vi.fn(),
      disconnect: vi.fn(),
    });
  });

  afterEach(() => {
    localStorage.clear();
    resetEnv();
  });

  it("sets Error('StakedPLUSD not configured') and does NOT call writeContract when SP address is zero", () => {
    const { result } = renderHook(() => useUnstake(), { wrapper });

    act(() => {
      result.current.write(1_000_000_000_000_000_000n);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toMatch(/StakedPLUSD not configured/);
    expect(mockWriteContract).not.toHaveBeenCalled();
  });
});

// ── useUnstake — reset semantics ──────────────────────────────────────────────

describe("useUnstake — reset semantics", () => {
  beforeEach(() => {
    localStorage.clear();
    resetEnv();
    mockUseWallet.mockReturnValue({
      address: undefined,
      isConnected: false,
      chainId: 560048,
      connect: vi.fn(),
      disconnect: vi.fn(),
    });
  });

  afterEach(() => {
    localStorage.clear();
    resetEnv();
  });

  it("reset() clears data and isSuccess in mock mode", async () => {
    const mockData = { hash: "0xdef", assets: "1042100000000000000" };
    localStorage.setItem(
      "pipeline.mock.wallet.contract.stakedPlusd.unstake",
      JSON.stringify(mockData),
    );

    const { result } = renderHook(() => useUnstake(), { wrapper });

    act(() => {
      result.current.write(1_000_000_000_000_000_000n);
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

// ── useStake — gas estimation tests ──────────────────────────────────────────

describe("useStake — gas estimation: cap clamp", () => {
  const walletAddr =
    "0xWALL000000000000000000000000000000000099" as `0x${string}`;

  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    mockEstimateContractGas.mockClear();
    mockSimulateContract.mockClear();
    mockSimulateContract.mockResolvedValue(undefined);
    resetEnv();
    mockUseWallet.mockReturnValue({
      address: walletAddr,
      isConnected: true,
      chainId: 560048,
      connect: vi.fn(),
      disconnect: vi.fn(),
    });
  });

  afterEach(() => {
    localStorage.clear();
    resetEnv();
  });

  it("clamps gas to EVM_TX_GAS_CAP when buffered estimate exceeds the cap", async () => {
    mockEnv.STAKED_PLUSD_ADDRESS = SP_ADDR;
    mockEstimateContractGas.mockResolvedValue(20_000_000n);

    const { result } = renderHook(() => useStake(), { wrapper });

    act(() => {
      result.current.write(1_000_000_000_000_000_000n);
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

describe("useStake — gas estimation: estimation rejects", () => {
  const walletAddr =
    "0xWALL000000000000000000000000000000000099" as `0x${string}`;

  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    mockEstimateContractGas.mockClear();
    mockSimulateContract.mockClear();
    mockSimulateContract.mockResolvedValue(undefined);
    resetEnv();
    mockUseWallet.mockReturnValue({
      address: walletAddr,
      isConnected: true,
      chainId: 560048,
      connect: vi.fn(),
      disconnect: vi.fn(),
    });
  });

  afterEach(() => {
    localStorage.clear();
    resetEnv();
  });

  it("surfaces error and does NOT call writeContract when estimation throws", async () => {
    mockEnv.STAKED_PLUSD_ADDRESS = SP_ADDR;
    mockEstimateContractGas.mockRejectedValue(
      new Error("execution reverted: insufficient balance"),
    );

    const { result } = renderHook(() => useStake(), { wrapper });

    act(() => {
      result.current.write(1_000_000_000_000_000_000n);
    });

    await waitFor(() => {
      expect(result.current.error).toBeTruthy();
    });

    expect(result.current.error?.message).toMatch(/insufficient balance/);
    expect(mockWriteContract).not.toHaveBeenCalled();
  });
});

describe("useStake — gas estimation: mock key bypasses estimation", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    mockEstimateContractGas.mockClear();
    mockSimulateContract.mockClear();
    mockSimulateContract.mockResolvedValue(undefined);
    resetEnv();
    mockUseWallet.mockReturnValue({
      address: undefined,
      isConnected: false,
      chainId: 560048,
      connect: vi.fn(),
      disconnect: vi.fn(),
    });
  });

  afterEach(() => {
    localStorage.clear();
    resetEnv();
  });

  it("does NOT call estimateContractGas when mock key is present", async () => {
    const mockData = { hash: "0xmocked", shares: "959600000000000000" };
    localStorage.setItem(
      "pipeline.mock.wallet.contract.stakedPlusd.stake",
      JSON.stringify(mockData),
    );

    const { result } = renderHook(() => useStake(), { wrapper });

    act(() => {
      result.current.write(1_000_000_000_000_000_000n);
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockEstimateContractGas).not.toHaveBeenCalled();
    expect(mockWriteContract).not.toHaveBeenCalled();
  });
});

// ── simulateOrFail integration ────────────────────────────────────────────────

describe("useStake — simulate reverts → writeContract not called", () => {
  const walletAddr =
    "0xWALL000000000000000000000000000000000050" as `0x${string}`;

  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    mockEstimateContractGas.mockClear();
    mockSimulateContract.mockClear();
    mockSimulateContract.mockResolvedValue(undefined);
    resetEnv();
    mockUseWallet.mockReturnValue({
      address: walletAddr,
      isConnected: true,
      chainId: 560048,
      connect: vi.fn(),
      disconnect: vi.fn(),
    });
  });

  afterEach(() => {
    localStorage.clear();
    resetEnv();
    mockEstimateContractGas.mockResolvedValue(1_000_000n);
    mockSimulateContract.mockResolvedValue(undefined);
  });

  it("sets error and skips writeContract when simulate rejects", async () => {
    mockEnv.STAKED_PLUSD_ADDRESS = SP_ADDR;
    mockSimulateContract.mockRejectedValueOnce(
      new Error("ERC4626ExceededMaxDeposit()"),
    );

    const { result } = renderHook(() => useStake(), { wrapper });

    act(() => {
      result.current.write(1_000_000_000_000_000_000n);
    });

    await waitFor(() => {
      expect(result.current.error).toBeInstanceOf(Error);
    });

    expect(result.current.error?.message).toContain(
      "ERC4626ExceededMaxDeposit",
    );
    expect(mockWriteContract).not.toHaveBeenCalled();
    expect(mockEstimateContractGas).not.toHaveBeenCalled();
  });
});

describe("useStake — simulate succeeds → estimate + write proceed", () => {
  const walletAddr =
    "0xWALL000000000000000000000000000000000051" as `0x${string}`;

  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    mockEstimateContractGas.mockClear();
    mockEstimateContractGas.mockResolvedValue(1_000_000n);
    mockSimulateContract.mockClear();
    mockSimulateContract.mockResolvedValue(undefined);
    resetEnv();
    mockUseWallet.mockReturnValue({
      address: walletAddr,
      isConnected: true,
      chainId: 560048,
      connect: vi.fn(),
      disconnect: vi.fn(),
    });
  });

  afterEach(() => {
    localStorage.clear();
    resetEnv();
    mockSimulateContract.mockResolvedValue(undefined);
  });

  it("calls simulateContract once with correct args before estimate + write", async () => {
    mockEnv.STAKED_PLUSD_ADDRESS = SP_ADDR;

    const { result } = renderHook(() => useStake(), { wrapper });

    act(() => {
      result.current.write(500_000_000_000_000_000n);
    });

    await waitFor(() => {
      expect(mockWriteContract).toHaveBeenCalled();
    });

    expect(mockSimulateContract).toHaveBeenCalledTimes(1);
    const simCalls = mockSimulateContract.mock.calls as unknown as Array<
      [Record<string, unknown>]
    >;
    const simCall = simCalls[0]![0]!;
    expect(simCall.functionName).toBe("deposit");
    expect((simCall.args as unknown[])[0]).toBe(500_000_000_000_000_000n);
    expect((simCall.args as unknown[])[1]).toBe(walletAddr);
    expect(mockEstimateContractGas).toHaveBeenCalledTimes(1);
  });
});

describe("useStake — mock key bypasses simulateContract", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    mockSimulateContract.mockClear();
    mockSimulateContract.mockResolvedValue(undefined);
    resetEnv();
    mockUseWallet.mockReturnValue({
      address: undefined,
      isConnected: false,
      chainId: 560048,
      connect: vi.fn(),
      disconnect: vi.fn(),
    });
  });

  afterEach(() => {
    localStorage.clear();
    resetEnv();
    mockSimulateContract.mockResolvedValue(undefined);
  });

  it("does NOT call simulateContract when stake mock key is present", async () => {
    const mockData = { hash: "0xstakemock", shares: "959600000000000000" };
    localStorage.setItem(
      "pipeline.mock.wallet.contract.stakedPlusd.stake",
      JSON.stringify(mockData),
    );

    const { result } = renderHook(() => useStake(), { wrapper });

    act(() => {
      result.current.write(1_000_000_000_000_000_000n);
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockSimulateContract).not.toHaveBeenCalled();
    expect(mockWriteContract).not.toHaveBeenCalled();
  });
});

describe("useUnstake — simulate reverts → writeContract not called", () => {
  const walletAddr =
    "0xWALL000000000000000000000000000000000052" as `0x${string}`;

  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    mockEstimateContractGas.mockClear();
    mockSimulateContract.mockClear();
    mockSimulateContract.mockResolvedValue(undefined);
    resetEnv();
    mockUseWallet.mockReturnValue({
      address: walletAddr,
      isConnected: true,
      chainId: 560048,
      connect: vi.fn(),
      disconnect: vi.fn(),
    });
  });

  afterEach(() => {
    localStorage.clear();
    resetEnv();
    mockEstimateContractGas.mockResolvedValue(1_000_000n);
    mockSimulateContract.mockResolvedValue(undefined);
  });

  it("sets error and skips writeContract when simulate rejects", async () => {
    mockEnv.STAKED_PLUSD_ADDRESS = SP_ADDR;
    mockSimulateContract.mockRejectedValueOnce(
      new Error("ERC4626ExceededMaxRedeem()"),
    );

    const { result } = renderHook(() => useUnstake(), { wrapper });

    act(() => {
      result.current.write(1_000_000_000_000_000_000n);
    });

    await waitFor(() => {
      expect(result.current.error).toBeInstanceOf(Error);
    });

    expect(result.current.error?.message).toContain("ERC4626ExceededMaxRedeem");
    expect(mockWriteContract).not.toHaveBeenCalled();
    expect(mockEstimateContractGas).not.toHaveBeenCalled();
  });
});

describe("useUnstake — simulate succeeds → estimate + write proceed", () => {
  const walletAddr =
    "0xWALL000000000000000000000000000000000053" as `0x${string}`;

  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    mockEstimateContractGas.mockClear();
    mockEstimateContractGas.mockResolvedValue(1_000_000n);
    mockSimulateContract.mockClear();
    mockSimulateContract.mockResolvedValue(undefined);
    resetEnv();
    mockUseWallet.mockReturnValue({
      address: walletAddr,
      isConnected: true,
      chainId: 560048,
      connect: vi.fn(),
      disconnect: vi.fn(),
    });
  });

  afterEach(() => {
    localStorage.clear();
    resetEnv();
    mockSimulateContract.mockResolvedValue(undefined);
  });

  it("calls simulateContract once with correct args before estimate + write", async () => {
    mockEnv.STAKED_PLUSD_ADDRESS = SP_ADDR;

    const { result } = renderHook(() => useUnstake(), { wrapper });

    act(() => {
      result.current.write(250_000_000_000_000_000n);
    });

    await waitFor(() => {
      expect(mockWriteContract).toHaveBeenCalled();
    });

    expect(mockSimulateContract).toHaveBeenCalledTimes(1);
    const simCalls2 = mockSimulateContract.mock.calls as unknown as Array<
      [Record<string, unknown>]
    >;
    const simCall2 = simCalls2[0]![0]!;
    expect(simCall2.functionName).toBe("redeem");
    expect((simCall2.args as unknown[])[0]).toBe(250_000_000_000_000_000n);
    expect((simCall2.args as unknown[])[1]).toBe(walletAddr);
    expect((simCall2.args as unknown[])[2]).toBe(walletAddr);
    expect(mockEstimateContractGas).toHaveBeenCalledTimes(1);
  });
});

describe("useUnstake — mock key bypasses simulateContract", () => {
  beforeEach(() => {
    localStorage.clear();
    mockWriteContract.mockClear();
    mockSimulateContract.mockClear();
    mockSimulateContract.mockResolvedValue(undefined);
    resetEnv();
    mockUseWallet.mockReturnValue({
      address: undefined,
      isConnected: false,
      chainId: 560048,
      connect: vi.fn(),
      disconnect: vi.fn(),
    });
  });

  afterEach(() => {
    localStorage.clear();
    resetEnv();
    mockSimulateContract.mockResolvedValue(undefined);
  });

  it("does NOT call simulateContract when unstake mock key is present", async () => {
    const mockData = { hash: "0xunstakemock", assets: "1042100000000000000" };
    localStorage.setItem(
      "pipeline.mock.wallet.contract.stakedPlusd.unstake",
      JSON.stringify(mockData),
    );

    const { result } = renderHook(() => useUnstake(), { wrapper });

    act(() => {
      result.current.write(1_000_000_000_000_000_000n);
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockSimulateContract).not.toHaveBeenCalled();
    expect(mockWriteContract).not.toHaveBeenCalled();
  });
});
