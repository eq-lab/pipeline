// spec: docs/product-specs/deposits.md#voucher-validity
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useDepositVoucher } from "./useDepositVoucher";

vi.mock("@/lib/env", () => ({
  ENV: {
    API_BASE_URL: "http://localhost:8080",
    EVM_CHAIN_ID: 560048,
    STELLAR_CHAIN_ID: 99000001,
  },
}));

vi.mock("@/wallet", () => ({
  useEvmWallet: vi.fn(() => ({
    address: "0x1111111111111111111111111111111111111111",
    isConnected: true,
  })),
  subscribeMock: vi.fn(() => () => {}),
}));

const mockApiFetch = vi.fn();
vi.mock("./client", () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

const T0 = Date.UTC(2026, 9, 29, 12, 0, 0);
const sec = (offset: number) => String(T0 / 1000 + offset);
const SIG_A = "ab".repeat(64);
const SIG_B = "cd".repeat(64);

function voucher(signature: string, deadline?: string) {
  return {
    request_id: "42",
    amount: "10000000",
    user: "0x1111111111111111111111111111111111111111",
    signature,
    ...(deadline === undefined ? {} : { deadline }),
  };
}

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("useDepositVoucher voucher deadline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("goes pending at the served deadline, then ready with the fresh voucher", async () => {
    const second = deferred<ReturnType<typeof voucher>>();
    mockApiFetch
      .mockResolvedValueOnce(voucher(SIG_A, sec(60)))
      .mockReturnValueOnce(second.promise);

    const { result } = renderHook(() => useDepositVoucher("42"), {
      wrapper: makeWrapper(),
    });
    await advance(0);
    expect(result.current.status).toBe("ready");
    expect(result.current.data?.signature).toBe(SIG_A);

    await advance(59_000);
    expect(result.current.status).toBe("ready");
    expect(mockApiFetch).toHaveBeenCalledTimes(1);

    await advance(1_000);
    expect(mockApiFetch).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe("pending");
    expect(result.current.data).toBeUndefined();

    await act(async () => {
      second.resolve(voucher(SIG_B, sec(60 + 86_400)));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe("ready");
    expect(result.current.data?.signature).toBe(SIG_B);
  });

  it("treats a voucher served already expired as absent and keeps refetching", async () => {
    mockApiFetch.mockResolvedValue(voucher(SIG_A, sec(-10)));

    const { result } = renderHook(() => useDepositVoucher("42"), {
      wrapper: makeWrapper(),
    });
    await advance(0);
    expect(result.current.status).toBe("pending");
    expect(result.current.data).toBeUndefined();

    await advance(3_000);
    expect(mockApiFetch.mock.calls.length).toBeGreaterThan(1);
    expect(result.current.status).toBe("pending");
  });

  it("a voucher without a deadline stays ready and is never refetched", async () => {
    mockApiFetch.mockResolvedValue(voucher(SIG_A));

    const { result } = renderHook(() => useDepositVoucher("42"), {
      wrapper: makeWrapper(),
    });
    await advance(0);
    expect(result.current.status).toBe("ready");

    await advance(24 * 3_600_000);
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("ready");
  });

  it("invalidate drops the voucher and refetches", async () => {
    const second = deferred<ReturnType<typeof voucher>>();
    mockApiFetch
      .mockResolvedValueOnce(voucher(SIG_A, sec(3_600)))
      .mockReturnValueOnce(second.promise);

    const { result } = renderHook(() => useDepositVoucher("42"), {
      wrapper: makeWrapper(),
    });
    await advance(0);
    expect(result.current.status).toBe("ready");

    await act(async () => {
      result.current.invalidate();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockApiFetch).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe("pending");

    await act(async () => {
      second.resolve(voucher(SIG_B, sec(7_200)));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe("ready");
    expect(result.current.data?.signature).toBe(SIG_B);
  });
});
