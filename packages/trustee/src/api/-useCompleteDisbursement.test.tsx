/**
 * Tests for `src/api/useCompleteDisbursement.ts` (issue #862). Mirrors the
 * `-useLoanValuation.test.tsx` fetch-mock + QueryClient setup, but for a
 * mutation:
 *   - POSTs `/v1/loan-book/{loan_id}/disbursement/complete?chain_id=99000001`.
 *   - Sends the bearer header (via apiFetch/sessionStore).
 *   - Resolves on a 200 empty body; invalidates the loan-book/financials/valuation
 *     queries on success.
 *   - Surfaces the 404 (loan not indexed) as an error.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCompleteDisbursement } from "./useCompleteDisbursement";

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

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function makeWrapper(client: QueryClient) {
  return function wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

beforeEach(() => {
  fetchMock.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useCompleteDisbursement", () => {
  it("POSTs the disbursement-complete endpoint with the bearer + chain_id", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 200 }));

    const { result } = renderHook(() => useCompleteDisbursement(), {
      wrapper: makeWrapper(makeClient()),
    });

    result.current.mutate({ loanId: "4488" });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const url = String(fetchMock.mock.calls[0]?.[0] ?? "");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(url).toContain("/v1/loan-book/4488/disbursement/complete");
    expect(url).toContain("chain_id=99000001");
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer test-token");
  });

  it("invalidates the loan-book / financials / valuation queries on success", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 200 }));
    const client = makeClient();
    const spy = vi.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => useCompleteDisbursement(), {
      wrapper: makeWrapper(client),
    });
    result.current.mutate({ loanId: "4488" });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const keys = spy.mock.calls.map(
      (c) => (c[0] as { queryKey: string[] }).queryKey[0],
    );
    expect(keys).toEqual(
      expect.arrayContaining([
        "loan-book",
        "loan-financials",
        "loan-valuation",
      ]),
    );
  });

  it("surfaces a 404 (loan not indexed) as an error", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "not indexed" }), {
        status: 404,
        statusText: "Not Found",
      }),
    );

    const { result } = renderHook(() => useCompleteDisbursement(), {
      wrapper: makeWrapper(makeClient()),
    });
    result.current.mutate({ loanId: "4488" });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });
});
