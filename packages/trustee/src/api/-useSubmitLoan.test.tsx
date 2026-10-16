import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSubmitLoan, type SubmitLoanInput } from "./useSubmitLoan";

vi.mock("@/lib/env", () => ({
  ENV: { API_BASE_URL: "http://localhost:8080" },
}));

vi.mock("@/auth/sessionStore", () => ({
  getSessionToken: () => "test-token",
}));

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const INPUT = { to: "0xabc", metadata_uri: "ipfs://x" } as SubmitLoanInput;

beforeEach(() => {
  fetchMock.mockReset();
});

describe("useSubmitLoan (#1536)", () => {
  it("POSTs the body to /v1/loan-book/loan with chain_id as the query and the bearer", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 42 }), { status: 201 }),
    );
    const { result } = renderHook(() => useSubmitLoan(), {
      wrapper: makeWrapper(),
    });

    let response: { id: number } | undefined;
    await act(async () => {
      response = await result.current.mutateAsync({
        chainId: 560048,
        input: INPUT,
      });
    });

    expect(response).toEqual({ id: 42 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(
      "http://localhost:8080/v1/loan-book/loan?chain_id=560048",
    );
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify(INPUT));
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer test-token",
    );
  });

  it("rejects on a 400 so the form can render the API's reason", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "unknown chain_id" }), {
        status: 400,
      }),
    );
    const { result } = renderHook(() => useSubmitLoan(), {
      wrapper: makeWrapper(),
    });
    await act(async () => {
      await expect(
        result.current.mutateAsync({ chainId: 5, input: INPUT }),
      ).rejects.toBeInstanceOf(Error);
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
