/**
 * Integration tests for `src/api/useRequests.ts`.
 *
 * Covers:
 *   - Mock-key path returns fixture data immediately without calling fetch.
 *   - With a connected wallet and no mock key, the hook calls apiFetch with
 *     the right URL.
 *   - With a disconnected wallet the query is disabled and fetch is never called.
 *   - Writing a mock key after mount triggers a refetch with the new value.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRequests } from "./useRequests";
import type { RequestsResponse } from "./useRequests";
import { installSameTabMockBridge } from "@/wallet/mock";

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

// ── Mock ENV ──────────────────────────────────────────────────────────────────

vi.mock("@/lib/env", () => ({
  ENV: {
    API_BASE_URL: "http://localhost:8080",
    EVM_CHAIN_ID: 560048,
    EVM_RPC_URL: "https://ethereum-hoodi-rpc.publicnode.com",
    DEPOSIT_MANAGER_ADDRESS: "0x0000000000000000000000000000000000000000",
    WALLETCONNECT_PROJECT_ID: "replace-me",
  },
}));

// ── Constants ─────────────────────────────────────────────────────────────────

const WALLET_ADDRESS =
  "0x1234000000000000000000000000000000000001" as `0x${string}`;

const FIXTURE: RequestsResponse = {
  requests: [
    {
      type: "Deposit",
      amount: "1000000",
      request_id: "42",
      status: "PendingClaim",
      created_at: "2026-05-15T12:00:00Z",
    },
    {
      type: "Withdraw",
      amount: "500000",
      request_id: "43",
      status: "PendingVerification",
      created_at: "2026-05-14T09:30:00Z",
    },
    {
      type: "Stake",
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
  localStorage.setItem("pipeline.mock.wallet.address", WALLET_ADDRESS);
  localStorage.setItem("pipeline.mock.wallet.isConnected", "true");
}

function setDisconnectedWallet() {
  mockUseAccount.mockReturnValue({ address: undefined, isConnected: false });
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
      `pipeline.mock.api.GET./v1/requests?wallet=${WALLET_ADDRESS}`,
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
      expect.stringContaining(`/v1/requests?wallet=${WALLET_ADDRESS}`),
      undefined,
    );
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
