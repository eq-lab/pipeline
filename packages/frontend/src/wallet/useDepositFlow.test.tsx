/**
 * Unit tests for the Stellar branch of `useDepositFlow` —
 * specifically `isManagerUnreachable`.
 *
 * Regression for: https://github.com/eq-lab/pipeline/issues/603
 *
 * The Stellar branch previously hardcoded `isManagerUnreachable: false`.
 * After the fix it computes manager reachability from the DepositManager
 * address resolver, and checks WithdrawalQueue configuration for withdrawals.
 *
 * Scenarios:
 *   1. Connected + addresses undefined + not loading → isManagerUnreachable = true
 *   2. Connected + addresses undefined + loading      → isManagerUnreachable = false (no flash)
 *   3. Connected + addresses defined (mock fast-path) → isManagerUnreachable = false
 *   4. Connected + withdraw queue unconfigured        → isManagerUnreachable = true
 *   5. Disconnected                                    → isManagerUnreachable = false
 */

import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useDepositFlow } from "./useDepositFlow";

// ── Hoisted state ─────────────────────────────────────────────────────────────
// vi.mock factories are hoisted to the top of the file, so mutable state used
// inside them must also be hoisted via vi.hoisted().

const mockState = vi.hoisted(() => ({
  stellarConnected: true,
  stellarAddresses: undefined as object | undefined,
  stellarLoading: false,
  stellarWithdrawalQueueId: "",
}));

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@reown/appkit/react", () => ({
  createAppKit: vi.fn(),
  useAppKit: vi.fn(() => ({ open: vi.fn() })),
}));

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
    useReadContract: vi.fn(() => ({
      data: undefined,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })),
    useWriteContract: vi.fn(() => ({
      writeContract: vi.fn(),
      data: undefined,
      isPending: false,
      isSuccess: false,
      error: null,
      reset: vi.fn(),
    })),
    usePublicClient: vi.fn(() => ({
      estimateContractGas: vi.fn(async () => 1_000_000n),
    })),
    useWaitForTransactionReceipt: vi.fn(() => ({
      data: undefined,
      isLoading: false,
      isSuccess: false,
      isError: false,
      error: null,
    })),
  };
});

vi.mock("@/wallet/config", () => ({
  wagmiConfig: {},
  wagmiAdapter: {},
}));

vi.mock("@/wallet/WalletViewContext", () => ({
  useWalletView: vi.fn(() => ({ kind: "stellar", setKind: vi.fn() })),
  WalletViewProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@/wallet/stellar/useStellarWallet", () => ({
  useStellarWallet: vi.fn(() => ({
    address: mockState.stellarConnected
      ? "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
      : undefined,
    isConnected: mockState.stellarConnected,
    connect: vi.fn(),
    signTransaction: vi.fn(),
  })),
}));

vi.mock("@/wallet/stellar/useStellarDepositManagerAddresses", () => ({
  useStellarDepositManagerAddresses: vi.fn(() => ({
    addresses: mockState.stellarAddresses,
    isLoading: mockState.stellarLoading,
    error: null,
  })),
}));

// Stub all other Stellar hooks used unconditionally by useDepositFlow

vi.mock("@/wallet/stellar/useStellarToken", () => ({
  useStellarToken: vi.fn(() => ({
    balance: undefined,
    formattedBalance: undefined,
    isLoading: false,
    refetchBalance: vi.fn(),
  })),
}));

vi.mock("@/wallet/stellar/useStellarSacToken", () => ({
  SAC_DECIMALS: 7,
  sacDisplayToRaw: (s: string) => BigInt(Math.round(parseFloat(s) * 1e7)),
  useStellarSacToken: vi.fn(() => ({
    balance: undefined,
    formattedBalance: undefined,
    isLoading: false,
    refetchBalance: vi.fn(),
  })),
}));

const minimalMutation = vi.hoisted(() => () => ({
  isPending: false,
  isSuccess: false,
  error: null as Error | null,
  write: vi.fn(),
  submit: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("@/wallet/stellar/useStellarDepositManager", () => ({
  useStellarRequestDeposit: minimalMutation,
  useStellarClaim: minimalMutation,
  useChangeTrust: minimalMutation,
  useStellarDepositRequest: vi.fn(() => ({
    data: undefined,
    isLoading: false,
    error: null,
  })),
  readInflightDeposit: vi.fn(() => null),
  writeInflightDeposit: vi.fn(),
  clearInflightDeposit: vi.fn(),
}));

vi.mock("@/wallet/stellar/useStellarWithdrawalQueue", () => ({
  useStellarRequestWithdrawal: minimalMutation,
  useStellarClaimWithdrawal: minimalMutation,
  useStellarChangeTrustUsdc: minimalMutation,
  useStellarWithdrawalRequest: vi.fn(() => ({
    data: undefined,
    isLoading: false,
    error: null,
  })),
  readInflightWithdrawal: vi.fn(() => null),
  writeInflightWithdrawal: vi.fn(),
  clearInflightWithdrawal: vi.fn(),
}));

vi.mock("@/wallet/stellar/useStellarNetworkFeeEstimate", () => ({
  useStellarNetworkFeeEstimate: vi.fn(() => ({ feeXlm: undefined })),
}));

vi.mock("@/api", () => ({
  useRequests: vi.fn(() => ({
    data: undefined,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  })),
  useDepositVoucher: vi.fn(() => ({
    data: undefined,
    status: "idle" as const,
    error: null,
  })),
  useWithdrawalVoucher: vi.fn(() => ({
    data: undefined,
    status: "idle" as const,
    error: null,
  })),
  useStellarDepositVoucher: vi.fn(() => ({
    data: undefined,
    status: "idle" as const,
    error: null,
  })),
  useStellarWithdrawalVoucher: vi.fn(() => ({
    data: undefined,
    status: "idle" as const,
    error: null,
  })),
}));

vi.mock("@/lib/env", () => ({
  ENV: {
    EVM_CHAIN_ID: 560048,
    EVM_RPC_URL: "https://rpc.example",
    DEPOSIT_MANAGER_ADDRESS:
      "0x0000000000000000000000000000000000000001" as `0x${string}`,
    WITHDRAWAL_QUEUE_ADDRESS:
      "0x0000000000000000000000000000000000000002" as `0x${string}`,
    WALLETCONNECT_PROJECT_ID: "test",
    STELLAR_DEPOSIT_MANAGER_ID: "",
    get STELLAR_WITHDRAWAL_QUEUE_ID() {
      return mockState.stellarWithdrawalQueueId;
    },
  },
}));

// ── Wrapper ───────────────────────────────────────────────────────────────────

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useDepositFlow — Stellar isManagerUnreachable", () => {
  beforeEach(() => {
    mockState.stellarConnected = true;
    mockState.stellarAddresses = undefined;
    mockState.stellarLoading = false;
    mockState.stellarWithdrawalQueueId = "";
  });

  it("returns isManagerUnreachable=true when connected, addresses undefined, not loading", () => {
    mockState.stellarConnected = true;
    mockState.stellarAddresses = undefined;
    mockState.stellarLoading = false;

    const { result } = renderHook(
      () => useDepositFlow("deposit", 0n, () => {}),
      { wrapper: makeWrapper() },
    );

    expect(result.current.isManagerUnreachable).toBe(true);
  });

  it("returns isManagerUnreachable=false while still loading (no flash during initial load)", () => {
    mockState.stellarConnected = true;
    mockState.stellarAddresses = undefined;
    mockState.stellarLoading = true;

    const { result } = renderHook(
      () => useDepositFlow("deposit", 0n, () => {}),
      { wrapper: makeWrapper() },
    );

    expect(result.current.isManagerUnreachable).toBe(false);
  });

  it("returns isManagerUnreachable=false when addresses are defined (configured / mock fast-path)", () => {
    mockState.stellarConnected = true;
    mockState.stellarAddresses = {
      usdc: "CCWX3TKH3K5SQDPOBGQTGOGE6Q5VEZWCOYJ2HDVV5U6GNN5U4WOEB3C7",
      plusd: "CAC7JMGRFZBL4IS4WBO5R3AMTK3C53FEOQZSU2WL5C4TWCRFAYWFSIBN",
      usdcAsset: {
        code: "USDC",
        issuer: "GC5SUAXMROK67LIE3DDMJG3AHHEVSFDAZ55A4WS655XYSKIN46RG7ACM",
      },
      plusdAsset: {
        code: "PLUSD",
        issuer: "GC5SUAXMROK67LIE3DDMJG3AHHEVSFDAZ55A4WS655XYSKIN46RG7ACM",
      },
    };
    mockState.stellarLoading = false;

    const { result } = renderHook(
      () => useDepositFlow("deposit", 0n, () => {}),
      { wrapper: makeWrapper() },
    );

    expect(result.current.isManagerUnreachable).toBe(false);
  });

  it("returns isManagerUnreachable=true for withdrawals when WithdrawalQueue is unconfigured", () => {
    mockState.stellarConnected = true;
    mockState.stellarAddresses = {
      usdc: "CCWX3TKH3K5SQDPOBGQTGOGE6Q5VEZWCOYJ2HDVV5U6GNN5U4WOEB3C7",
      plusd: "CAC7JMGRFZBL4IS4WBO5R3AMTK3C53FEOQZSU2WL5C4TWCRFAYWFSIBN",
      usdcAsset: {
        code: "USDC",
        issuer: "GC5SUAXMROK67LIE3DDMJG3AHHEVSFDAZ55A4WS655XYSKIN46RG7ACM",
      },
      plusdAsset: {
        code: "PLUSD",
        issuer: "GC5SUAXMROK67LIE3DDMJG3AHHEVSFDAZ55A4WS655XYSKIN46RG7ACM",
      },
    };
    mockState.stellarLoading = false;
    mockState.stellarWithdrawalQueueId = "";

    const { result } = renderHook(
      () => useDepositFlow("withdraw", 0n, () => {}),
      { wrapper: makeWrapper() },
    );

    expect(result.current.isManagerUnreachable).toBe(true);
  });

  it("returns isManagerUnreachable=false when wallet is disconnected", () => {
    mockState.stellarConnected = false;
    mockState.stellarAddresses = undefined;
    mockState.stellarLoading = false;

    const { result } = renderHook(
      () => useDepositFlow("deposit", 0n, () => {}),
      { wrapper: makeWrapper() },
    );

    expect(result.current.isManagerUnreachable).toBe(false);
  });
});
