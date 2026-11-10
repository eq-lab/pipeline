// spec: docs/frontend/trustee-flows.md#cash-management--bank-wire-outs
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { CashBookResponse } from "@/api/useCashBook";

vi.mock("@/api/useCashBook", () => ({ useCashBook: vi.fn() }));
vi.mock("@/auth/sessionStore", () => ({ useSessionState: vi.fn() }));
vi.mock("@/api/useEscrowedWires", () => ({
  useMinterPlusdId: vi.fn(),
  ensureMinterPlusdId: vi.fn(),
}));
vi.mock("@/api/useWireOuts", () => ({
  useWireOutRecords: vi.fn(),
  useWireOutAccess: vi.fn(),
  useSettleWireOut: vi.fn(),
  useCancelWireOut: vi.fn(),
  fetchWireOutRecord: vi.fn(),
}));
vi.mock("@pipeline/wallet-connect", () => ({
  useStellarWallet: vi.fn(),
  readPlusdAuthorization: vi.fn(),
  readWireInRefHashSeen: vi.fn(),
  wireInReturnRefHash: vi.fn(),
  parseUsdDollarsToI128: vi.fn(),
}));
vi.mock("@/lib/env", () => ({
  ENV: {
    STELLAR_CHAIN_ID: 99_000_001,
    EVM_CHAIN_ID: 560048,
    STELLAR_YIELD_MINTER_ID: "CMINTER",
    STELLAR_LOAN_REGISTRY_EXECUTOR_ID: "CAM",
  },
}));

import { useCashBook } from "@/api/useCashBook";
import { useSessionState } from "@/auth/sessionStore";
import { useMinterPlusdId } from "@/api/useEscrowedWires";
import {
  useCancelWireOut,
  useSettleWireOut,
  useWireOutAccess,
  useWireOutRecords,
} from "@/api/useWireOuts";
import { useStellarWallet } from "@pipeline/wallet-connect";
import {
  WIRE_OUT_PENDING_REFETCH_MS,
  WIRE_OUT_PENDING_WINDOW_MS,
  WIRE_OUT_REFETCH_MS,
  plusdAmount,
  useWireOutsSection,
  wireOutResultMessage,
} from "./-wire-outs";

const mockCashBook = vi.mocked(useCashBook);
const mockSession = vi.mocked(useSessionState);

const BOOK: CashBookResponse = {
  chain_id: 99_000_001,
  minter: "CMINTER",
  summary: { bank_cash: "0", in_flight: "0", complete: true },
  wire_ins: [],
  wire_outs: [
    {
      id: 7,
      status: "Pending",
      lp: "GLP",
      amount: "10.5",
      requested_at: "2026-11-03T10:15:00Z",
    },
  ],
  ramps: [],
};

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

function setChain(status: string) {
  vi.mocked(useWireOutRecords).mockReturnValue([
    {
      data: { id: 7, lp: "GLP", amount: "105000000", requestedAt: 1, status },
      isPending: false,
      isError: false,
    },
  ] as unknown as ReturnType<typeof useWireOutRecords>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockReturnValue({
    chainId: 99_000_001,
  } as unknown as ReturnType<typeof useSessionState>);
  mockCashBook.mockReturnValue({
    data: BOOK,
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useCashBook>);
  vi.mocked(useStellarWallet).mockReturnValue({
    isConnected: true,
    address: "GTRUSTEE",
  } as unknown as ReturnType<typeof useStellarWallet>);
  vi.mocked(useMinterPlusdId).mockReturnValue(
    {} as ReturnType<typeof useMinterPlusdId>,
  );
  vi.mocked(useWireOutAccess).mockReturnValue({
    data: { immediate: true, delay: 0 },
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof useWireOutAccess>);
  const mutation = {
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
    stage: null,
    reset: vi.fn(),
  };
  vi.mocked(useSettleWireOut).mockReturnValue(mutation);
  vi.mocked(useCancelWireOut).mockReturnValue(mutation);
});

afterEach(() => {
  vi.useRealTimers();
});

function lastRefetchMs(): number {
  const calls = mockCashBook.mock.calls;
  return calls[calls.length - 1]![1].refetchMs;
}

describe("useWireOutsSection polling", () => {
  it("polls at the slow rate while the chain agrees with the cash book", () => {
    setChain("Pending");
    renderHook(() => useWireOutsSection(), { wrapper });
    expect(lastRefetchMs()).toBe(WIRE_OUT_REFETCH_MS);
  });

  it("polls fast while pending-index and falls back after the window", () => {
    vi.useFakeTimers();
    setChain("Settled");
    const { result } = renderHook(() => useWireOutsSection(), { wrapper });
    expect(result.current.rows[0]!.chainState).toBe("settled-pending-index");
    expect(lastRefetchMs()).toBe(WIRE_OUT_PENDING_REFETCH_MS);
    act(() => {
      vi.advanceTimersByTime(WIRE_OUT_PENDING_WINDOW_MS + 1);
    });
    expect(lastRefetchMs()).toBe(WIRE_OUT_REFETCH_MS);
  });
});

describe("useWireOutsSection state", () => {
  it("is unsupported on EVM and does not enable the fetch", () => {
    mockSession.mockReturnValue({
      chainId: 560048,
    } as unknown as ReturnType<typeof useSessionState>);
    setChain("Pending");
    const { result } = renderHook(() => useWireOutsSection(), { wrapper });
    expect(result.current.state).toBe("unsupported");
    expect(mockCashBook.mock.calls[0]![1].enabled).toBe(false);
  });
});

describe("presenters", () => {
  it("formats the served amount with grouping and a PLUSD suffix", () => {
    expect(plusdAmount("1234567.123456")).toBe("1,234,567.123456 PLUSD");
  });

  it("builds the unverified message", () => {
    expect(
      wireOutResultMessage({
        kind: "unverified",
        id: 2,
        hash: "H",
        action: "cancelled",
      }),
    ).toBe(
      "Wire-out #2 cancelled on-chain, but the result could not be re-read. Refresh the list. Transaction H.",
    );
  });
});
