/**
 * Integration tests for `src/api/useRequests.ts`.
 *
 * Covers:
 *   - Mock-key path returns fixture data immediately without calling fetch.
 *   - With a connected wallet and no mock key, the hook calls apiFetch with
 *     the right URL.
 *   - With a disconnected wallet the query is disabled and fetch is never called.
 *   - Writing a mock key after mount triggers a refetch with the new value.
 *   - Stellar view selects the Stellar wallet address.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRequests, useInvalidateRequests } from "./useRequests";
import type { RequestsResponse } from "./useRequests";
import { installSameTabMockBridge } from "@/wallet/evm/mock";

// ── Mock wagmi / AppKit ───────────────────────────────────────────────────────

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
    useReadContract: vi.fn(() => ({
      data: undefined,
      isLoading: false,
      error: null,
    })),
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

vi.mock("@/wallet/config", () => ({
  wagmiConfig: {},
  wagmiAdapter: {},
}));

// ── Mock Stellar wallet + WalletView ──────────────────────────────────────────

const mockUseStellarWallet = vi.fn(() => ({
  address: undefined as string | undefined,
  isConnected: false,
}));

const mockUseWalletView = vi.fn(() => ({
  kind: "evm" as "evm" | "stellar",
}));

// connectionStore.ts subscribes to addressUpdatedEvent and disconnectEvent at
// module scope, so the mock must export them.
vi.mock("@creit.tech/stellar-wallets-kit", () => ({
  StellarWalletsKit: Object.assign(vi.fn(), {
    init: vi.fn(),
  }),
  addressUpdatedEvent: { subscribe: vi.fn() },
  disconnectEvent: { subscribe: vi.fn() },
  WalletNetwork: { TESTNET: "TESTNET" },
  Networks: {
    TESTNET: "Test SDF Network ; September 2015",
    PUBLIC: "Public Global Stellar Network ; September 2015",
  },
}));

vi.mock("@creit.tech/stellar-wallets-kit/modules/utils", () => ({
  defaultModules: vi.fn(() => []),
}));

vi.mock("@/wallet/stellar/useStellarWallet", () => ({
  useStellarWallet: () => mockUseStellarWallet(),
}));

vi.mock("@/wallet/WalletViewContext", () => ({
  useWalletView: () => mockUseWalletView(),
  WalletViewProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

// ── Mock ENV ──────────────────────────────────────────────────────────────────

vi.mock("@/lib/env", () => ({
  ENV: {
    API_BASE_URL: "http://localhost:8080",
    EVM_CHAIN_ID: 560048,
    EVM_RPC_URL: "https://ethereum-hoodi-rpc.publicnode.com",
    DEPOSIT_MANAGER_ADDRESS: "0x0000000000000000000000000000000000000000",
    WALLETCONNECT_PROJECT_ID: "replace-me",
    STELLAR_CHAIN_ID: 99_000_001,
  },
}));

// ── Constants ─────────────────────────────────────────────────────────────────

const WALLET_ADDRESS =
  "0x1234000000000000000000000000000000000001" as `0x${string}`;

const STELLAR_ADDRESS =
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

const FIXTURE: RequestsResponse = {
  requests: [
    {
      type: "Deposit",
      chain_id: 560048,
      amount: "1000000",
      request_id: "42",
      status: "PendingClaim",
      created_at: "2026-05-15T12:00:00Z",
    },
    {
      type: "Withdraw",
      chain_id: 560048,
      amount: "500000",
      request_id: "43",
      status: "PendingVerification",
      created_at: "2026-05-14T09:30:00Z",
    },
    {
      type: "Stake",
      chain_id: 560048,
      amount: "1000000000000000000000",
      assets: "1000000000000000000000",
      shares: "999500000000000000000",
      status: "Completed",
      created_at: "2026-05-13T18:00:00Z",
    },
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

// Replace globalThis.fetch entirely for this test file so no real network
// calls can be made.
const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);
const fetchSpy = fetchMock; // alias for test assertions

// Install the same-tab mock bridge so localStorage.setItem writes dispatch
// the custom event needed for mock-key reactivity.
installSameTabMockBridge();

/** Create a fresh QueryClient per test to avoid cache bleeding. */
function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
  return wrapper;
}

function setConnectedWallet() {
  mockUseAccount.mockReturnValue({
    address: WALLET_ADDRESS,
    isConnected: true,
  });
  mockUseWalletView.mockReturnValue({ kind: "evm" });
  mockUseStellarWallet.mockReturnValue({
    address: undefined,
    isConnected: false,
  });
  localStorage.setItem("pipeline.mock.wallet.address", WALLET_ADDRESS);
  localStorage.setItem("pipeline.mock.wallet.isConnected", "true");
}

function setDisconnectedWallet() {
  mockUseAccount.mockReturnValue({ address: undefined, isConnected: false });
  mockUseWalletView.mockReturnValue({ kind: "evm" });
  mockUseStellarWallet.mockReturnValue({
    address: undefined,
    isConnected: false,
  });
}

function setConnectedStellarWallet() {
  mockUseAccount.mockReturnValue({ address: undefined, isConnected: false });
  mockUseWalletView.mockReturnValue({ kind: "stellar" });
  mockUseStellarWallet.mockReturnValue({
    address: STELLAR_ADDRESS,
    isConnected: true,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useRequests — mock-key path", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchSpy.mockClear();
    setConnectedWallet();
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("returns fixture data immediately from mock key, never calls fetch", async () => {
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/requests",
      JSON.stringify(FIXTURE),
    );

    const { result } = renderHook(() => useRequests(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(FIXTURE);
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("per-wallet mock key takes priority over the alias key", async () => {
    const perWalletFixture: RequestsResponse = { requests: [] };
    localStorage.setItem(
      `pipeline.mock.api.GET./v1/requests?wallet=${WALLET_ADDRESS}&chain_id=560048`,
      JSON.stringify(perWalletFixture),
    );
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/requests",
      JSON.stringify(FIXTURE),
    );

    const { result } = renderHook(() => useRequests(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(perWalletFixture);
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("useRequests — real fetch path", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchSpy.mockClear();
    setConnectedWallet();
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("calls fetch with the correct URL when no mock key is set", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(FIXTURE), { status: 200 }),
    );

    const { result } = renderHook(() => useRequests(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(FIXTURE);
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        `/v1/requests?wallet=${WALLET_ADDRESS}&chain_id=560048`,
      ),
      undefined,
    );
  });

  it("refetches with the Stellar chain id when the wallet view switches (#1567)", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify(FIXTURE), { status: 200 }),
    );

    const { result, rerender } = renderHook(() => useRequests(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(result.current.data).toEqual(FIXTURE);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    setConnectedStellarWallet();
    rerender();

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
    const url = String(fetchSpy.mock.calls[1]?.[0] ?? "");
    expect(url).toContain(`wallet=${STELLAR_ADDRESS}`);
    expect(url).toContain("chain_id=99000001");
    expect(url).not.toContain("chain_id=560048");
  });
});

describe("useRequests — disconnected wallet", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchSpy.mockClear();
    setDisconnectedWallet();
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("never calls fetch when wallet is disconnected", async () => {
    const { result } = renderHook(() => useRequests(), {
      wrapper: makeWrapper(),
    });

    // Wait a tick to let any async work settle
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });
});

describe("useRequests — mock-key reactivity", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchSpy.mockClear();
    setConnectedWallet();
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("writing a mock key after mount and calling refetch returns updated data", async () => {
    const initialFixture: RequestsResponse = {
      requests: [
        {
          type: "Deposit",
          chain_id: 560048,
          amount: "1000000",
          request_id: "1",
          status: "Completed",
          created_at: "2026-05-15T12:00:00Z",
        },
      ],
    };
    const updatedFixture: RequestsResponse = { requests: [] };

    // Start with initial mock data
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/requests",
      JSON.stringify(initialFixture),
    );

    const { result } = renderHook(() => useRequests(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(initialFixture);
    });

    // Update the mock key then call refetch() to pick up the new value.
    // This mirrors the DevTools console flow: set the key, then the page
    // refreshes (either automatically via mock-key reactivity, or manually).
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/requests",
      JSON.stringify(updatedFixture),
    );

    await act(async () => {
      result.current.refetch();
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(updatedFixture);
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("useRequests — Stellar wallet view", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchSpy.mockClear();
    setConnectedStellarWallet();
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("uses the Stellar address when wallet view is stellar (mock-key path)", async () => {
    const stellarFixture: RequestsResponse = {
      requests: [
        {
          type: "Deposit",
          chain_id: 560048,
          amount: "10000000",
          request_id: "99",
          status: "PendingClaim",
          created_at: "2026-06-01T10:00:00Z",
        },
      ],
    };

    localStorage.setItem(
      "pipeline.mock.api.GET./v1/requests",
      JSON.stringify(stellarFixture),
    );

    const { result } = renderHook(() => useRequests(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(stellarFixture);
    });

    // No fetch call — mock-key path
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("calls fetch with the Stellar address when no mock key is set", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ requests: [] }), { status: 200 }),
    );

    const { result } = renderHook(() => useRequests(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        `/v1/requests?wallet=${STELLAR_ADDRESS}&chain_id=99000001`,
      ),
      undefined,
    );
  });

  it("does NOT use the EVM address when wallet view is stellar", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ requests: [] }), { status: 200 }),
    );

    renderHook(() => useRequests(), { wrapper: makeWrapper() });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Ensure the EVM address (0x…) is NOT in the fetch call
    const firstCall = fetchSpy.mock.calls[0];
    if (firstCall !== undefined) {
      const url = firstCall[0] as string;
      expect(url).not.toContain(WALLET_ADDRESS);
      expect(url).toContain(STELLAR_ADDRESS);
    }
  });
});

describe("useRequests — function refetchInterval (#1658)", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchSpy.mockClear();
    setConnectedWallet();
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("passes the latest data to a function-form interval", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify(FIXTURE), { status: 200 }),
    );
    const interval = vi.fn((): number | false => false);

    const { result } = renderHook(
      () => useRequests({ refetchInterval: interval }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(result.current.data).toEqual(FIXTURE);
    });
    await waitFor(() => {
      expect(interval).toHaveBeenCalledWith(FIXTURE);
    });
  });
});

describe("useInvalidateRequests (#1658)", () => {
  it("invalidates every requests query and leaves others alone", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["requests", "evm", "0xa", 560048, 0], FIXTURE);
    queryClient.setQueryData(
      ["requests", "stellar", "G", 99000001, 0],
      FIXTURE,
    );
    queryClient.setQueryData(["pnl", "0xa"], { ok: true });
    function wrapper({ children }: { children: React.ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      );
    }

    const { result, rerender } = renderHook(() => useInvalidateRequests(), {
      wrapper,
    });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);

    act(() => {
      result.current();
    });

    expect(
      queryClient.getQueryState(["requests", "evm", "0xa", 560048, 0])
        ?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(["requests", "stellar", "G", 99000001, 0])
        ?.isInvalidated,
    ).toBe(true);
    expect(queryClient.getQueryState(["pnl", "0xa"])?.isInvalidated).toBe(
      false,
    );
  });
});
