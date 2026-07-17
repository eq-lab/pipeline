/**
 * Tests for `useLoanCcrHistory.ts` (issue #879). Mirrors
 * `-useLoanFinancials.test.tsx`: `fetch` is stubbed so the hook is exercised
 * end-to-end through `apiFetch` without a real backend. Asserts the request URL
 * (path + `from`/`step`/`chain_id` query) and the disabled-until-`from` gating.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLoanCcrHistory } from "./useLoanCcrHistory";
import type { CcrHistoryResponse } from "./useLoanCcrHistory";

vi.mock("@/lib/env", () => ({
  ENV: {
    API_BASE_URL: "http://localhost:8080",
    STELLAR_CHAIN_ID: 99_000_001,
  },
}));

vi.mock("@/auth/sessionStore", () => ({
  getSessionToken: () => "test-token",
}));

const FIXTURE: CcrHistoryResponse = {
  loan_id: "5",
  chain_id: 99_000_001,
  from: "2026-05-01T00:00:00Z",
  to: "2026-06-01T00:00:00Z",
  step_seconds: 86_400,
  points: [
    { timestamp: "2026-05-01T00:00:00Z", ccr_bps: 14_600 },
    { timestamp: "2026-06-01T00:00:00Z", ccr_bps: 11_400 },
  ],
};

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

beforeEach(() => {
  fetchMock.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useLoanCcrHistory", () => {
  it("requests /ccr-history with from, step, and chain_id, returning the series", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(FIXTURE), { status: 200 }),
    );

    const { result } = renderHook(() => useLoanCcrHistory("5", 1_746_057_600), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.data).toEqual(FIXTURE));
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("/v1/loan-book/5/ccr-history");
    expect(url).toContain("from=1746057600");
    expect(url).toContain("step=86400");
    expect(url).toContain("chain_id=99000001");
  });

  it("sends a custom step", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(FIXTURE), { status: 200 }),
    );
    renderHook(() => useLoanCcrHistory("5", 1_746_057_600, 3_600), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("step=3600");
  });

  it("stays disabled (no fetch) until `from` is known", () => {
    renderHook(() => useLoanCcrHistory("5", null), {
      wrapper: makeWrapper(),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stays disabled when the loan id is empty", () => {
    renderHook(() => useLoanCcrHistory("", 1_746_057_600), {
      wrapper: makeWrapper(),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
