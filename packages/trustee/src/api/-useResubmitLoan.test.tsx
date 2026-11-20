// spec: docs/frontend/trustee-flows.md#amend-and-resubmit-originationidedit-1913
import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "./client";
import { useResubmitLoan } from "./useResubmitLoan";
import type { SubmitLoanInput } from "./useSubmitLoan";

vi.mock("@/lib/env", () => ({
  ENV: { API_BASE_URL: "http://localhost:8080" },
}));

vi.mock("@/auth/sessionStore", () => ({
  getSessionToken: () => "test-token",
}));

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

const INPUT = {
  data_room_id: "DR-1",
  metadata_uri: "ipfs://x",
} as unknown as SubmitLoanInput;

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { invalidate, ...renderHook(() => useResubmitLoan(), { wrapper }) };
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe("useResubmitLoan (#1913)", () => {
  it("POSTs the body to the resubmit path with no chain_id, JSON content type and the bearer", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 42, draw_loan: null }), {
        status: 200,
      }),
    );
    const { result } = setup();

    let response: unknown;
    await act(async () => {
      response = await result.current.mutateAsync({ id: 42, input: INPUT });
    });

    expect(response).toEqual({ id: 42, draw_loan: null });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(
      "http://localhost:8080/v1/loan-book/submissions/42/resubmit",
    );
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify(INPUT));
    const headers = new Headers(init?.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("authorization")).toBe("Bearer test-token");
  });

  it("invalidates loan-submissions before mutateAsync resolves", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 42 }), { status: 200 }),
    );
    let release: () => void = () => undefined;
    const { result, invalidate } = setup();
    invalidate.mockImplementation(
      () => new Promise<void>((resolve) => (release = resolve)),
    );

    let resolved = false;
    let pending: Promise<unknown> = Promise.resolve();
    await act(async () => {
      pending = result.current
        .mutateAsync({ id: 42, input: INPUT })
        .then(() => {
          resolved = true;
        });
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["loan-submissions"],
    });
    expect(resolved).toBe(false);
    await act(async () => {
      release();
      await pending;
    });
    expect(resolved).toBe(true);
  });

  it("rejects a 409 with an ApiError carrying the status and served message", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: "submission 42 is not in ChangesRequested" }),
        { status: 409 },
      ),
    );
    const { result } = setup();
    let caught: unknown;
    await act(async () => {
      caught = await result.current
        .mutateAsync({ id: 42, input: INPUT })
        .catch((e: unknown) => e);
    });
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(409);
    expect((caught as ApiError).message).toContain("not in ChangesRequested");
  });
});
