// spec: docs/frontend/trustee-flows.md#security-card
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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
vi.mock("@/auth/sessionStore", () => ({ getSessionToken: () => "t" }));
vi.mock("@/api/useDealToken", () => ({
  useDeal: () => ({ data: undefined, isPending: false, isError: false }),
}));

import { useLoanDetail } from "./-useLoanDetail";
import { loanBook, loanEntry } from "./-riskCouncilFixtures";

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((input) => {
    const url = String(input);
    if (url.includes("/security")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            terms: { advance_ratio_bps: 8000, margin_call_ratio_bps: 8500 },
            valuation: { ltv_bps: 8123 },
          }),
          { status: 200 },
        ),
      );
    }
    if (url.endsWith("/v1/loan-book") || url.includes("/v1/loan-book?")) {
      return Promise.resolve(
        new Response(JSON.stringify(loanBook([loanEntry()])), { status: 200 }),
      );
    }
    return Promise.resolve(new Response("{}", { status: 404 }));
  });
});

describe("useLoanDetail network surface", () => {
  it("never requests the removed /valuations or /ccr-history endpoints", async () => {
    const { result } = renderHook(() => useLoanDetail(99_000_001, "4471"), {
      wrapper,
    });
    await waitFor(() => {
      expect(result.current.security.state).toBe("ready");
    });
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/security"))).toBe(true);
    expect(urls.some((u) => u.includes("/valuations"))).toBe(false);
    expect(urls.some((u) => u.includes("/ccr-history"))).toBe(false);
  });

  it("does not request /security for an EVM loan", async () => {
    const { result } = renderHook(() => useLoanDetail(560048, "4471"), {
      wrapper,
    });
    await waitFor(() => {
      expect(result.current.state).not.toBe("loading");
    });
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/security"))).toBe(false);
    expect(result.current.security.state).toBe("hidden");
  });
});
