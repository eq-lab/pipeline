/**
 * Tests for `src/components/dashboard/useWithdrawalQueuePanel.ts`.
 *
 * Covers the state machine:
 *   - loading: while the query is in-flight.
 *   - error: when the query fails.
 *   - empty: when items array is empty.
 *   - ready: formatted summary + rows + row-expand affordance.
 *
 * Uses the `pipeline.mock.api.*` localStorage mock layer (same approach as
 * `useLoanBook.test.tsx`).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useWithdrawalQueuePanel } from "./useWithdrawalQueuePanel";
import type { WithdrawalQueueResponse } from "@/api/useWithdrawalQueue";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/wallet", () => ({
  useWalletView: () => ({ kind: "evm" }),
  useEvmWallet: () => ({ address: undefined, isConnected: false }),
  useStellarWallet: () => ({ address: undefined, isConnected: false }),
  subscribeMock: () => () => {},
  readMock: (key: string, parse: (raw: string) => unknown) => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return undefined;
      return parse(raw);
    } catch {
      return undefined;
    }
  },
  parseJson: (value: string) => JSON.parse(value) as unknown,
}));

vi.mock("@/lib/env", () => ({
  ENV: {
    API_BASE_URL: "http://localhost:8080",
    EVM_CHAIN_ID: 560048,
    EVM_RPC_URL: "https://ethereum-hoodi-rpc.publicnode.com",
    DEPOSIT_MANAGER_ADDRESS: "0x0000000000000000000000000000000000000000",
    WALLETCONNECT_PROJECT_ID: "replace-me",
  },
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FIXTURE_WITH_ITEMS: WithdrawalQueueResponse = {
  summary: {
    in_queue_usd: "1850000.000000",
    requests_count: 6,
    estimated_wait_days: "3.2",
    liquid_cover: null,
  },
  items: [
    {
      account: "0x7a3f2b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f3f",
      amount: "620000.000000",
      status: "Completed",
    },
    {
      account: "0xabcdef1234567890abcdef1234567890abcdef12",
      amount: "480000.000000",
      status: "Queued",
    },
  ],
};

/** Fixture with more than 5 items to test "Show more". */
const FIXTURE_SIX_ITEMS: WithdrawalQueueResponse = {
  summary: {
    in_queue_usd: "3000000.000000",
    requests_count: 6,
    estimated_wait_days: "5.0",
    liquid_cover: null,
  },
  items: [
    {
      account: "0x1111111111111111111111111111111111111111",
      amount: "100000.000000",
      status: "Completed",
    },
    {
      account: "0x2222222222222222222222222222222222222222",
      amount: "200000.000000",
      status: "Queued",
    },
    {
      account: "0x3333333333333333333333333333333333333333",
      amount: "300000.000000",
      status: "Queued",
    },
    {
      account: "0x4444444444444444444444444444444444444444",
      amount: "400000.000000",
      status: "Completed",
    },
    {
      account: "0x5555555555555555555555555555555555555555",
      amount: "500000.000000",
      status: "Queued",
    },
    {
      account: "0x6666666666666666666666666666666666666666",
      amount: "600000.000000",
      status: "Queued",
    },
  ],
};

const FIXTURE_EMPTY: WithdrawalQueueResponse = {
  summary: {
    in_queue_usd: "0.000000",
    requests_count: 0,
    estimated_wait_days: null,
    liquid_cover: null,
  },
  items: [],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

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

// ── Tests — loading state ─────────────────────────────────────────────────────

describe("useWithdrawalQueuePanel — loading state", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockClear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("returns loading state while query is in-flight", () => {
    // No mock key, no fetch mock → remains in-flight
    fetchMock.mockImplementationOnce(() => new Promise(() => {}));

    const { result } = renderHook(() => useWithdrawalQueuePanel(), {
      wrapper: makeWrapper(),
    });

    expect(result.current.state).toBe("loading");
    expect(result.current.summary.inQueue).toBe("—");
    expect(result.current.summary.requests).toBe("—");
    expect(result.current.summary.estimatedWait).toBe("—");
    expect(result.current.summary.liquidCover).toBe("—");
    expect(result.current.visibleRows).toHaveLength(0);
  });
});

// ── Tests — error state ───────────────────────────────────────────────────────

describe("useWithdrawalQueuePanel — error state", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockClear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("returns error state when fetch fails", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "server error" }), {
        status: 500,
        statusText: "Internal Server Error",
      }),
    );

    const { result } = renderHook(() => useWithdrawalQueuePanel(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.state).toBe("error");
    });

    expect(result.current.summary.inQueue).toBe("—");
    expect(result.current.errorMessage).toBeDefined();
    expect(result.current.visibleRows).toHaveLength(0);
  });
});

// ── Tests — empty state ───────────────────────────────────────────────────────

describe("useWithdrawalQueuePanel — empty state", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockClear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("returns empty state when items is empty", async () => {
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/withdrawal-queue",
      JSON.stringify(FIXTURE_EMPTY),
    );

    const { result } = renderHook(() => useWithdrawalQueuePanel(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.state).toBe("empty");
    });

    expect(result.current.summary.inQueue).toBe("—");
    expect(result.current.visibleRows).toHaveLength(0);
  });
});

// ── Tests — ready state ───────────────────────────────────────────────────────

describe("useWithdrawalQueuePanel — ready state", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockClear();
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/withdrawal-queue",
      JSON.stringify(FIXTURE_WITH_ITEMS),
    );
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("enters ready state", async () => {
    const { result } = renderHook(() => useWithdrawalQueuePanel(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.state).toBe("ready");
    });
  });

  it("formats inQueue as compact USD", async () => {
    const { result } = renderHook(() => useWithdrawalQueuePanel(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.state).toBe("ready"));

    // 1850000 → $1.9M
    expect(result.current.summary.inQueue).toBe("$1.9M");
  });

  it("formats requests as plain integer string", async () => {
    const { result } = renderHook(() => useWithdrawalQueuePanel(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.state).toBe("ready"));

    expect(result.current.summary.requests).toBe("6");
  });

  it("formats estimatedWait with tilde prefix", async () => {
    const { result } = renderHook(() => useWithdrawalQueuePanel(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.state).toBe("ready"));

    expect(result.current.summary.estimatedWait).toBe("~3.2 days");
  });

  it("formats liquidCover as '—' when null", async () => {
    const { result } = renderHook(() => useWithdrawalQueuePanel(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.state).toBe("ready"));

    expect(result.current.summary.liquidCover).toBe("—");
  });

  it("truncates holder address to 6+4 form", async () => {
    const { result } = renderHook(() => useWithdrawalQueuePanel(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.state).toBe("ready"));

    // "0x7a3f2b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f3f" → "0x7a3f…9f3f"
    const row0 = result.current.visibleRows[0];
    expect(row0).toBeDefined();
    expect(row0!.holder).toBe("0x7a3f…9f3f");
  });

  it("formats amount as compact USD", async () => {
    const { result } = renderHook(() => useWithdrawalQueuePanel(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.state).toBe("ready"));

    // 620000 → $620.0K
    const row0 = result.current.visibleRows[0];
    expect(row0).toBeDefined();
    expect(row0!.amount).toBe("$620.0K");
  });

  it("maps status verbatim", async () => {
    const { result } = renderHook(() => useWithdrawalQueuePanel(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.state).toBe("ready"));

    const row0 = result.current.visibleRows[0];
    const row1 = result.current.visibleRows[1];
    expect(row0).toBeDefined();
    expect(row1).toBeDefined();
    expect(row0!.status).toBe("Completed");
    expect(row1!.status).toBe("Queued");
  });
});

// ── Tests — row expand ────────────────────────────────────────────────────────

describe("useWithdrawalQueuePanel — row expand", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockClear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("shows only 5 rows by default when there are 6 items", async () => {
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/withdrawal-queue",
      JSON.stringify(FIXTURE_SIX_ITEMS),
    );

    const { result } = renderHook(() => useWithdrawalQueuePanel(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.state).toBe("ready"));

    expect(result.current.visibleRows).toHaveLength(5);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.expanded).toBe(false);
  });

  it("shows all rows after showMore() is called", async () => {
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/withdrawal-queue",
      JSON.stringify(FIXTURE_SIX_ITEMS),
    );

    const { result } = renderHook(() => useWithdrawalQueuePanel(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.state).toBe("ready"));

    act(() => {
      result.current.showMore();
    });

    expect(result.current.visibleRows).toHaveLength(6);
    expect(result.current.expanded).toBe(true);
    expect(result.current.hasMore).toBe(true);
  });

  it("hasMore is false when there are 5 or fewer items", async () => {
    localStorage.setItem(
      "pipeline.mock.api.GET./v1/withdrawal-queue",
      JSON.stringify(FIXTURE_WITH_ITEMS),
    );

    const { result } = renderHook(() => useWithdrawalQueuePanel(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.state).toBe("ready"));

    expect(result.current.hasMore).toBe(false);
    expect(result.current.visibleRows).toHaveLength(2);
  });
});
