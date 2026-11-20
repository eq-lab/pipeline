// spec: docs/product-specs/trustee-attention-counts.md#api-contract
import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAttentionCounts, attentionCountsKey } from "./useAttentionCounts";
import { ApiError } from "./client";

vi.mock("@/lib/env", () => ({
  ENV: {
    API_BASE_URL: "http://localhost:8080",
    EVM_CHAIN_ID: 560048,
    STELLAR_CHAIN_ID: 99_000_001,
    EVM_RPC_URL: "https://ethereum-hoodi-rpc.publicnode.com",
    WALLETCONNECT_PROJECT_ID: "replace-me",
    STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  },
}));

vi.mock("@/auth/sessionStore", () => ({
  getSessionToken: () => "test-token",
}));

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

function setup() {
  const queryClient = new QueryClient();
  function wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
  return { queryClient, wrapper };
}

const BODY = {
  origination: { count: 2 },
  loans: { count: 3 },
  cash_management: { count: 4 },
  chains: [],
};

beforeEach(() => {
  fetchMock.mockReset();
});

describe("useAttentionCounts", () => {
  it("requests the bare path with the bearer token and returns the body", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(BODY), { status: 200 }),
    );
    const { wrapper } = setup();
    const { result } = renderHook(() => useAttentionCounts(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(BODY));
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "http://localhost:8080/v1/attention-counts",
    );
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("Authorization")).toBe("Bearer test-token");
  });

  it("does not retry a 403", async () => {
    fetchMock.mockResolvedValue(new Response("no", { status: 403 }));
    const { wrapper } = setup();
    const { result } = renderHook(() => useAttentionCounts(), { wrapper });
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("polls every 30 s and retries a 500 at most twice", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(BODY), { status: 200 }),
    );
    const { queryClient, wrapper } = setup();
    renderHook(() => useAttentionCounts(), { wrapper });
    await waitFor(() =>
      expect(
        queryClient.getQueryCache().find({ queryKey: attentionCountsKey }),
      ).toBeDefined(),
    );
    const options = queryClient
      .getQueryCache()
      .find({ queryKey: attentionCountsKey })!.options;
    expect((options as { refetchInterval?: number }).refetchInterval).toBe(
      30_000,
    );
    const retry = options.retry as (c: number, e: Error) => boolean;
    const e500 = new ApiError("boom", 500);
    expect(retry(0, e500)).toBe(true);
    expect(retry(1, e500)).toBe(true);
    expect(retry(2, e500)).toBe(false);
    expect(retry(0, new ApiError("nf", 404))).toBe(false);
  });
});
