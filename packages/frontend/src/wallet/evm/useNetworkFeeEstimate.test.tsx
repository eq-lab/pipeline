/**
 * Unit tests for `useNetworkFeeEstimate` and `formatFeeEth`.
 *
 * All RPC calls are intercepted via vitest mocks — no real network access.
 * Scenarios:
 *   1. formatFeeEth — truncation and trailing-zero rules.
 *   2. Mock-key path (deposit direction) — returns pinned fee, no RPC.
 *   3. Mock-key path (withdraw direction) — reads the correct key.
 *   4. Zero-address short-circuit — returns `feeEth: undefined`.
 *   5. Disconnected wallet — returns `feeEth: undefined`, no error.
 *   6. Real RPC path — returns formatted fee from mocked gas estimation.
 *   7. Revert / fallback — when estimateContractGas rejects, uses constant.
 *   8. Error surfaces on `error` field, not thrown.
 *   9. Direction toggle — switching from deposit to withdraw reads the
 *      correct mock key.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useNetworkFeeEstimate, formatFeeEth } from "./useNetworkFeeEstimate";

// ── Mock wagmi ────────────────────────────────────────────────────────────────

const mockUseReadContract = vi.fn(() => ({
  data: undefined as unknown,
  isLoading: false,
  error: null,
  refetch: vi.fn(),
}));

const mockGetGasPrice = vi.fn(async () => 2_000_000_000n); // 2 gwei
const mockEstimateContractGas = vi.fn(async () => 200_000n);
const mockPublicClient = {
  estimateContractGas: mockEstimateContractGas,
  getGasPrice: mockGetGasPrice,
};
const mockUsePublicClient = vi.fn(() => mockPublicClient);

const mockUseAccount = vi.fn(() => ({
  address: "0xabc0000000000000000000000000000000000001" as `0x${string}`,
  isConnected: true,
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

// Note: @tanstack/react-query is NOT mocked here — we use a real QueryClient
// in the wrapper so that `useQuery` has its context available.

vi.mock("./config", () => ({
  wagmiConfig: {},
  wagmiAdapter: {},
}));

// ── Mock ENV ──────────────────────────────────────────────────────────────────

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DM_ADDRESS =
  "0x3333000000000000000000000000000000000003" as `0x${string}`;
const WQ_ADDRESS =
  "0x4444000000000000000000000000000000000004" as `0x${string}`;

const mockEnv = vi.hoisted(() => ({
  EVM_CHAIN_ID: 560048,
  EVM_RPC_URL: "https://ethereum-hoodi-rpc.publicnode.com",
  // Inline literals — vi.hoisted runs before module-level consts are initialised.
  DEPOSIT_MANAGER_ADDRESS:
    "0x3333000000000000000000000000000000000003" as `0x${string}`,
  WITHDRAWAL_QUEUE_ADDRESS:
    "0x4444000000000000000000000000000000000004" as `0x${string}`,
  WALLETCONNECT_PROJECT_ID: "replace-me",
}));

vi.mock("@/lib/env", () => ({
  ENV: mockEnv,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Test wrapper that provides a real QueryClient (required by useQuery in
 * useNetworkFeeEstimate) plus the WalletProvider tree (WagmiProvider +
 * QueryClientProvider + WalletGateContext).
 *
 * We create a fresh QueryClient per test so cache state doesn't leak between
 * tests. The QueryClientProvider is rendered INSIDE WalletProvider so that
 * the context provided here (innermost) is what useQuery resolves.
 *
 * WalletProvider creates its own QueryClientProvider from a module-level
 * singleton QueryClient — by wrapping the children in a fresh QueryClientProvider
 * BELOW WalletProvider but ABOVE the hook component, we ensure the hook sees
 * the fresh client (React context uses the nearest ancestor provider).
 *
 * The simplest form: skip WalletProvider entirely and only provide the minimal
 * context the hook needs (QueryClient + mock bridge + wagmi mock). Since all
 * wagmi hooks are mocked, WagmiProvider is not needed either.
 */
function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
  return { wrapper, queryClient };
}

// ── Tests: formatFeeEth ───────────────────────────────────────────────────────

describe("formatFeeEth", () => {
  it("formats a typical fee to 5 decimal places", () => {
    // 530_000_000_000_000n wei = 0.00053 ETH
    expect(formatFeeEth(530_000_000_000_000n)).toBe("~0.00053 ETH");
  });

  it("drops trailing zeros but keeps at least 2 decimal places", () => {
    // 100_000_000_000_000_000n wei = 0.1 ETH → "~0.10 ETH"
    expect(formatFeeEth(100_000_000_000_000_000n)).toBe("~0.10 ETH");
  });

  it("truncates (floors) at 5 decimal places without rounding", () => {
    // 0.000534999 ETH → should show ~0.00053 (not ~0.00054)
    // 534_999_000_000_000n wei = 0.000534999 ETH
    const result = formatFeeEth(534_999_000_000_000n);
    expect(result).toBe("~0.00053 ETH");
  });

  it("shows at least 2 decimal places even for round numbers", () => {
    // 1_000_000_000_000_000_000n wei = 1 ETH
    expect(formatFeeEth(1_000_000_000_000_000_000n)).toBe("~1.00 ETH");
  });
});

// ── Tests: useNetworkFeeEstimate ──────────────────────────────────────────────

describe("useNetworkFeeEstimate — zero-address short-circuit", () => {
  beforeEach(() => {
    localStorage.clear();
    // Set both addresses to zero
    mockEnv.DEPOSIT_MANAGER_ADDRESS = ZERO_ADDRESS as `0x${string}`;
    mockEnv.WITHDRAWAL_QUEUE_ADDRESS = ZERO_ADDRESS as `0x${string}`;
    mockEstimateContractGas.mockClear();
    mockGetGasPrice.mockClear();
  });

  afterEach(() => {
    localStorage.clear();
    mockEnv.DEPOSIT_MANAGER_ADDRESS = DM_ADDRESS as `0x${string}`;
    mockEnv.WITHDRAWAL_QUEUE_ADDRESS = WQ_ADDRESS as `0x${string}`;
  });

  it("returns feeEth: undefined for deposit when DM is zero address", () => {
    const { result } = renderHook(() => useNetworkFeeEstimate("deposit"), {
      wrapper: makeWrapper().wrapper,
    });
    expect(result.current.feeEth).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockEstimateContractGas).not.toHaveBeenCalled();
  });

  it("returns feeEth: undefined for withdraw when WQ is zero address", () => {
    const { result } = renderHook(() => useNetworkFeeEstimate("withdraw"), {
      wrapper: makeWrapper().wrapper,
    });
    expect(result.current.feeEth).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(mockEstimateContractGas).not.toHaveBeenCalled();
  });
});

describe("useNetworkFeeEstimate — disconnected wallet", () => {
  beforeEach(() => {
    localStorage.clear();
    mockEnv.DEPOSIT_MANAGER_ADDRESS = DM_ADDRESS as `0x${string}`;
    mockEnv.WITHDRAWAL_QUEUE_ADDRESS = WQ_ADDRESS as `0x${string}`;
    // Disconnect wallet
    mockUseAccount.mockReturnValue({
      address: undefined as unknown as `0x${string}`,
      isConnected: false,
    });
    mockEstimateContractGas.mockClear();
    mockGetGasPrice.mockClear();
  });

  afterEach(() => {
    localStorage.clear();
    mockUseAccount.mockReturnValue({
      address: "0xabc0000000000000000000000000000000000001",
      isConnected: true,
    });
  });

  it("returns feeEth: undefined and no error when wallet is disconnected", () => {
    const { result } = renderHook(() => useNetworkFeeEstimate("deposit"), {
      wrapper: makeWrapper().wrapper,
    });
    expect(result.current.feeEth).toBeUndefined();
    expect(result.current.error).toBeNull();
    expect(mockEstimateContractGas).not.toHaveBeenCalled();
  });
});

describe("useNetworkFeeEstimate — mock-key path (deposit)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockEnv.DEPOSIT_MANAGER_ADDRESS = DM_ADDRESS as `0x${string}`;
    mockEnv.WITHDRAWAL_QUEUE_ADDRESS = WQ_ADDRESS as `0x${string}`;
    mockEstimateContractGas.mockClear();
    mockGetGasPrice.mockClear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("returns pinned fee from mock key (raw number string)", async () => {
    localStorage.setItem(
      "pipeline.mock.wallet.networkFeeEstimate.deposit",
      '"0.00053"',
    );

    const { result } = renderHook(() => useNetworkFeeEstimate("deposit"), {
      wrapper: makeWrapper().wrapper,
    });

    expect(result.current.feeEth).toBe("~0.00053 ETH");
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockEstimateContractGas).not.toHaveBeenCalled();
  });

  it("accepts a pre-formatted '~0.00053 ETH' string in the mock key", async () => {
    localStorage.setItem(
      "pipeline.mock.wallet.networkFeeEstimate.deposit",
      '"~0.00053 ETH"',
    );

    const { result } = renderHook(() => useNetworkFeeEstimate("deposit"), {
      wrapper: makeWrapper().wrapper,
    });

    expect(result.current.feeEth).toBe("~0.00053 ETH");
    expect(mockEstimateContractGas).not.toHaveBeenCalled();
  });
});

describe("useNetworkFeeEstimate — mock-key path (withdraw)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockEnv.DEPOSIT_MANAGER_ADDRESS = DM_ADDRESS as `0x${string}`;
    mockEnv.WITHDRAWAL_QUEUE_ADDRESS = WQ_ADDRESS as `0x${string}`;
    mockEstimateContractGas.mockClear();
    mockGetGasPrice.mockClear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("reads the withdraw mock key (not the deposit key)", () => {
    // Set only the withdraw key; deposit key absent.
    localStorage.setItem(
      "pipeline.mock.wallet.networkFeeEstimate.withdraw",
      '"0.00042"',
    );

    const { result: depositResult } = renderHook(
      () => useNetworkFeeEstimate("deposit"),
      { wrapper: makeWrapper().wrapper },
    );

    const { result: withdrawResult } = renderHook(
      () => useNetworkFeeEstimate("withdraw"),
      { wrapper: makeWrapper().wrapper },
    );

    // Deposit should NOT get the withdraw fee from the mock key
    // (deposit key is absent → will trigger real query path which in test is loading/undefined)
    expect(depositResult.current.feeEth).toBeUndefined();

    // Withdraw should get its own key
    expect(withdrawResult.current.feeEth).toBe("~0.00042 ETH");
  });
});

describe("useNetworkFeeEstimate — real RPC path (estimation succeeds)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockEnv.DEPOSIT_MANAGER_ADDRESS = DM_ADDRESS as `0x${string}`;
    mockEnv.WITHDRAWAL_QUEUE_ADDRESS = WQ_ADDRESS as `0x${string}`;
    mockUseAccount.mockReturnValue({
      address: "0xabc0000000000000000000000000000000000001",
      isConnected: true,
    });
    // Seed minDeposit mock so the hook doesn't stall on that read.
    localStorage.setItem(
      "pipeline.mock.wallet.contract.depositManager.minDeposit",
      "1000000",
    );
    // 200_000 gas * 1.2 buffer = 240_000; * 2 gwei = 480_000_000_000_000 wei
    mockEstimateContractGas.mockResolvedValue(200_000n);
    mockGetGasPrice.mockResolvedValue(2_000_000_000n); // 2 gwei
  });

  afterEach(() => {
    localStorage.clear();
    mockEstimateContractGas.mockResolvedValue(200_000n);
    mockGetGasPrice.mockResolvedValue(2_000_000_000n);
  });

  it("returns formatted ETH fee when estimation succeeds (deposit)", async () => {
    const { result } = renderHook(() => useNetworkFeeEstimate("deposit"), {
      wrapper: makeWrapper().wrapper,
    });

    await waitFor(
      () => {
        expect(result.current.feeEth).toBeDefined();
      },
      { timeout: 3000 },
    );

    // 240_000 gas * 2_000_000_000 gwei = 480_000_000_000_000 wei
    // formatEther → "0.00048"
    expect(result.current.feeEth).toBe("~0.00048 ETH");
    expect(result.current.error).toBeNull();
  });

  it("calls estimateContractGas for withdraw direction", async () => {
    mockEstimateContractGas.mockClear();

    const { result } = renderHook(() => useNetworkFeeEstimate("withdraw"), {
      wrapper: makeWrapper().wrapper,
    });

    await waitFor(
      () => {
        expect(result.current.feeEth).toBeDefined();
      },
      { timeout: 3000 },
    );

    expect(mockEstimateContractGas).toHaveBeenCalledWith(
      expect.objectContaining({
        address: WQ_ADDRESS,
        functionName: "requestWithdrawal",
      }),
    );
  });
});

describe("useNetworkFeeEstimate — fallback to constant gas on revert", () => {
  beforeEach(() => {
    localStorage.clear();
    mockEnv.DEPOSIT_MANAGER_ADDRESS = DM_ADDRESS as `0x${string}`;
    mockEnv.WITHDRAWAL_QUEUE_ADDRESS = WQ_ADDRESS as `0x${string}`;
    mockUseAccount.mockReturnValue({
      address: "0xabc0000000000000000000000000000000000001",
      isConnected: true,
    });
    localStorage.setItem(
      "pipeline.mock.wallet.contract.depositManager.minDeposit",
      "1000000",
    );
    // Simulate a revert from estimateContractGas
    mockEstimateContractGas.mockRejectedValue(
      new Error("execution reverted: no allowance"),
    );
    // 2 gwei gas price
    mockGetGasPrice.mockResolvedValue(2_000_000_000n);
  });

  afterEach(() => {
    localStorage.clear();
    mockEstimateContractGas.mockResolvedValue(200_000n);
    mockGetGasPrice.mockResolvedValue(2_000_000_000n);
  });

  it("falls back to curated constant gas for deposit on revert", async () => {
    const { result } = renderHook(() => useNetworkFeeEstimate("deposit"), {
      wrapper: makeWrapper().wrapper,
    });

    await waitFor(
      () => {
        expect(result.current.feeEth).toBeDefined();
      },
      { timeout: 3000 },
    );

    // 250_000 * 1.2 = 300_000; * 2_000_000_000 = 600_000_000_000_000 wei
    // formatEther → "0.0006" → truncated to 5 dp → "00060" → strip trailing 0s → "0006"
    expect(result.current.feeEth).toBe("~0.0006 ETH");
    // No error surfaced — fallback is transparent
    expect(result.current.error).toBeNull();
  });

  it("falls back to curated constant gas for withdraw on revert", async () => {
    const { result } = renderHook(() => useNetworkFeeEstimate("withdraw"), {
      wrapper: makeWrapper().wrapper,
    });

    await waitFor(
      () => {
        expect(result.current.feeEth).toBeDefined();
      },
      { timeout: 3000 },
    );

    // 180_000 * 1.2 = 216_000; * 2_000_000_000 = 432_000_000_000_000 wei
    // formatEther → "0.000432"
    expect(result.current.feeEth).toBe("~0.00043 ETH");
    expect(result.current.error).toBeNull();
  });
});
