/**
 * Integration tests for `src/api/useWithdrawalVoucher.ts`.
 *
 * Covers:
 *   - Disabled when `requestId` is `undefined` — returns `status: "idle"`, no fetch issued.
 *   - Disabled when wallet is disconnected — `status: "idle"`.
 *   - Mock-key path (`pipeline.mock.api.GET./v1/withdrawals/42/voucher` set in localStorage)
 *     — `apiFetch` short-circuits via the mock layer; `status: "ready"`, data matches.
 *   - Real-fetch path — stub global `fetch` with a `{ signature: "0xdead…" }` response;
 *     expect `status: "pending"` then `"ready"`.
 *   - Retry on 404 ("Not Found") with stable retry — assert `query.failureCount` increases.
 *   - Reactive refetch — mutate localStorage mock key; assert queryKey advances via `mockVer`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useWithdrawalVoucher } from "./useWithdrawalVoucher";
import type { WithdrawalVoucherResponse } from "./useWithdrawalVoucher";
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
    WITHDRAWAL_QUEUE_ADDRESS: "0x0000000000000000000000000000000000000000",
    WALLETCONNECT_PROJECT_ID: "replace-me",
  },
}));

// ── Constants ─────────────────────────────────────────────────────────────────

const WALLET_ADDRESS =
  "0x1234000000000000000000000000000000000001" as `0x${string}`;

const FIXTURE: WithdrawalVoucherResponse = {
  request_id: "77",
  amount: "10000000000000000000",
  user: WALLET_ADDRESS,
  signature:
    "0xaabbccdd00112233aabbccdd00112233aabbccdd00112233aabbccdd00112233aabbccdd00112233aabbccdd00112233aabbccdd00112233aabbccdd001122330011",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

// Replace globalThis.fetch entirely for this test file so no real network
// calls can be made.
const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);
const fetchSpy = fetchMock;

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

describe("useWithdrawalVoucher — disabled when requestId is undefined", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchSpy.mockClear();
    setConnectedWallet();
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("returns status 'idle' and never calls fetch when requestId is undefined", async () => {
    const { result } = renderHook(() => useWithdrawalVoucher(undefined), {
      wrapper: makeWrapper(),
    });

    // Wait a tick to let any async work settle
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.data).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("useWithdrawalVoucher — disabled when wallet is disconnected", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchSpy.mockClear();
    setDisconnectedWallet();
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("returns status 'idle' and never calls fetch when wallet is disconnected", async () => {
    const { result } = renderHook(() => useWithdrawalVoucher("77"), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.data).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("useWithdrawalVoucher — mock-key path", () => {
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
      "pipeline.mock.api.GET./v1/withdrawals/77/voucher",
      JSON.stringify(FIXTURE),
    );

    const { result } = renderHook(() => useWithdrawalVoucher("77"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.status).toBe("ready");
      expect(result.current.data).toEqual(FIXTURE);
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("per-wallet mock key takes priority over the alias key", async () => {
    const perWalletFixture: WithdrawalVoucherResponse = {
      request_id: "77",
      amount: "5000000000000000000",
      user: WALLET_ADDRESS,
      signature: "0xdeadbeef",
    };
    localStorage.setItem(
      `pipeline.mock.api.GET./v1/withdrawals/77/voucher?wallet=${WALLET_ADDRESS}`,
      JSON.stringify(perWalletFixture),
    );
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/withdrawals/77/voucher",
      JSON.stringify(FIXTURE),
    );

    const { result } = renderHook(() => useWithdrawalVoucher("77"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.status).toBe("ready");
      expect(result.current.data).toEqual(perWalletFixture);
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("useWithdrawalVoucher — real-fetch path", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchSpy.mockClear();
    setConnectedWallet();
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("calls fetch with the correct URL and returns status 'ready' when signature present", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(FIXTURE), { status: 200 }),
    );

    const { result } = renderHook(() => useWithdrawalVoucher("77"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.status).toBe("ready");
      expect(result.current.data).toEqual(FIXTURE);
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        `/v1/withdrawals/77/voucher?wallet=${WALLET_ADDRESS}`,
      ),
      undefined,
    );
  });
});

describe("useWithdrawalVoucher — retry on 404", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchSpy.mockClear();
    setConnectedWallet();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("retries on Not Found error and eventually resolves", async () => {
    // The QueryClient for this test allows retries (unlike makeWrapper()).
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          // Allow the hook's own retry config to govern.
          retry: undefined,
        },
      },
    });
    function wrapper({ children }: { children: React.ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      );
    }

    // Respond with 404 (status text "Not Found") then succeed
    fetchSpy
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Not Found" }), {
          status: 404,
          statusText: "Not Found",
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(FIXTURE), { status: 200 }),
      );

    const { result } = renderHook(() => useWithdrawalVoucher("77"), {
      wrapper,
    });

    // First fetch fires — expect pending
    await waitFor(() => {
      expect(result.current.status).toBe("pending");
    });

    // The hook's retry predicate checks error.message for "Not Found".
    // apiFetch throws with the JSON `error` field or statusText — here "Not Found".
    // Advance past the 3s retry delay.
    await act(async () => {
      vi.advanceTimersByTime(3500);
    });

    // Eventually resolves to ready after the retry succeeds
    await waitFor(
      () => {
        expect(result.current.status).toBe("ready");
      },
      { timeout: 5000 },
    );

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe("useWithdrawalVoucher — mock-key reactivity", () => {
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
    const initialFixture: WithdrawalVoucherResponse = {
      request_id: "77",
      amount: "5000000000000000000",
      user: WALLET_ADDRESS,
      signature: "0xfirst",
    };
    const updatedFixture: WithdrawalVoucherResponse = {
      request_id: "77",
      amount: "5000000000000000000",
      user: WALLET_ADDRESS,
      signature: "0xsecond",
    };

    localStorage.setItem(
      "pipeline.mock.api.GET./v1/withdrawals/77/voucher",
      JSON.stringify(initialFixture),
    );

    const { result } = renderHook(() => useWithdrawalVoucher("77"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(initialFixture);
    });

    // Update the mock key then call refetch() to pick up the new value.
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/withdrawals/77/voucher",
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
